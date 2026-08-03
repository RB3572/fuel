import Foundation
import AuthenticationServices
import CryptoKit
import UIKit

// Signing in with the same credentials as the website.
//
// The site keys every user row on their email address, so proving that address is all
// that matters. Two ways to do it, both native:
//
//   • Google — the system browser sheet on accounts.google.com. Same account picker the
//     website uses, so it is literally the same sign-in, not a Fuel consent screen in
//     front of it.
//   • Apple — the system sheet, no browser at all.
//
// Either way the phone ends up holding an ID token, posts it to /api/auth/native, and
// gets back an ordinary Fuel token pair. The app never sees a password.

@MainActor
@Observable
final class SignIn: NSObject {
    struct Tokens: Codable {
        var accessToken: String
        var refreshToken: String?
        var expiresAt: Date
        var email: String?
        var name: String?

        var isFresh: Bool { expiresAt > Date().addingTimeInterval(60) }
    }

    private(set) var tokens: Tokens?
    private(set) var busy = false
    var error: String?

    var isSignedIn: Bool { tokens != nil }
    var email: String? { tokens?.email }

    private var baseURL: String
    private var webSession: ASWebAuthenticationSession?
    private var appleContinuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>?
    private var appleNonce: String?

    init(baseURL: String) {
        self.baseURL = baseURL
        super.init()
        tokens = Self.load()
    }

    func updateBaseURL(_ url: String) { baseURL = url }

    func signOut() {
        tokens = nil
        Keychain.set("", for: "fuel-tokens")
    }

    /// A valid access token, refreshed if it has aged out.
    func accessToken() async -> String? {
        guard let tokens else { return nil }
        if tokens.isFresh { return tokens.accessToken }
        guard let refresh = tokens.refreshToken else { return nil }
        try? await refreshTokens(refresh)
        return self.tokens?.accessToken
    }

    // MARK: - Apple

    func signInWithApple() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            let nonce = Self.randomURLSafe(32)
            appleNonce = nonce
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.email, .fullName]
            // Apple signs the SHA-256 of the nonce into the token; the server checks the
            // token's signature, and this ties it to this specific request.
            request.nonce = Self.sha256(nonce)

            let credential = try await performAppleRequest(request)
            guard let identityToken = credential.identityToken,
                  let token = String(data: identityToken, encoding: .utf8) else {
                throw NSError(domain: "Fuel", code: 1,
                              userInfo: [NSLocalizedDescriptionKey: "Apple did not return an identity token."])
            }
            // Apple sends the email and name exactly once, on first authorization, so
            // they are forwarded now or never.
            let name = [credential.fullName?.givenName, credential.fullName?.familyName]
                .compactMap { $0 }.joined(separator: " ")
            try await exchange(provider: "apple", idToken: token,
                               email: credential.email, name: name.isEmpty ? nil : name)
        } catch {
            if (error as NSError).code == ASAuthorizationError.canceled.rawValue { return }
            self.error = error.localizedDescription
        }
    }

    private func performAppleRequest(_ request: ASAuthorizationAppleIDRequest) async throws -> ASAuthorizationAppleIDCredential {
        try await withCheckedThrowingContinuation { continuation in
            appleContinuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    // MARK: - Google

    /// Google, without a Google iOS client.
    ///
    /// An iOS OAuth client would be a second registration to keep in sync, and a web
    /// client cannot redirect to a custom scheme — so instead this opens Fuel's own
    /// Google flow. What the user sees is Google's account picker, the same one the
    /// website shows; Fuel is only the invisible redirect at the end. The client secret
    /// stays on the server, which is the point: a shipped app cannot keep one.
    func signInWithGoogle() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            let verifier = Self.randomURLSafe(64)
            var components = URLComponents(string: baseURL + "/api/auth/google/start")!
            components.queryItems = [
                .init(name: "native", value: "1"),
                .init(name: "code_challenge", value: Self.s256(verifier)),
            ]

            let callback = try await webAuth(url: components.url!, scheme: "fuel")
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            if let failure = items.first(where: { $0.name == "error" })?.value {
                throw NSError(domain: "Fuel", code: 2,
                              userInfo: [NSLocalizedDescriptionKey: "Google sign-in failed (\(failure))."])
            }
            guard let code = items.first(where: { $0.name == "code" })?.value else {
                throw NSError(domain: "Fuel", code: 3,
                              userInfo: [NSLocalizedDescriptionKey: "Fuel did not return a sign-in code."])
            }
            try await exchange(handoffCode: code, verifier: verifier)
        } catch {
            if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { return }
            self.error = error.localizedDescription
        }
    }

    private func webAuth(url: URL, scheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callback, error in
                if let error { continuation.resume(throwing: error) }
                else if let callback { continuation.resume(returning: callback) }
                else { continuation.resume(throwing: NSError(domain: "Fuel", code: 4)) }
            }
            session.presentationContextProvider = self
            webSession = session
            session.start()
        }
    }

    // MARK: - Fuel

    /// Hand the identity token to Fuel, which verifies it and returns its own tokens.
    private func exchange(provider: String, idToken: String, email: String?, name: String?) async throws {
        var payload: [String: Any] = ["provider": provider, "idToken": idToken]
        if let email { payload["email"] = email }
        if let name { payload["name"] = name }
        try await postNative(payload)
    }

    private func postNative(_ payload: [String: Any]) async throws {
        var request = URLRequest(url: URL(string: baseURL + "/api/auth/native")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await URLSession.shared.data(for: request)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              let access = object?["access_token"] as? String else {
            throw NSError(domain: "Fuel", code: 5, userInfo: [
                NSLocalizedDescriptionKey: (object?["error"] as? String) ?? "Fuel could not verify that sign-in.",
            ])
        }
        let user = object?["user"] as? [String: Any]
        let next = Tokens(accessToken: access,
                          refreshToken: object?["refresh_token"] as? String,
                          expiresAt: Date().addingTimeInterval((object?["expires_in"] as? Double) ?? 3600),
                          email: user?["email"] as? String ?? payload["email"] as? String,
                          name: user?["name"] as? String ?? payload["name"] as? String)
        tokens = next
        Self.save(next)
    }

    /// Redeem the one-time code from Fuel's Google callback. PKCE means an app that
    /// hijacked the URL scheme and stole the code still cannot spend it.
    private func exchange(handoffCode: String, verifier: String) async throws {
        try await postNative(["provider": "fuel", "code": handoffCode, "codeVerifier": verifier])
    }

    private func refreshTokens(_ refreshToken: String) async throws {
        var request = URLRequest(url: URL(string: baseURL + "/oauth/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = "grant_type=refresh_token&refresh_token=\(refreshToken)&client_id=fuel-native"
            .data(using: .utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = object["access_token"] as? String else { return }
        var next = tokens
        next?.accessToken = access
        next?.refreshToken = object["refresh_token"] as? String ?? tokens?.refreshToken
        next?.expiresAt = Date().addingTimeInterval((object["expires_in"] as? Double) ?? 3600)
        if let next { tokens = next; Self.save(next) }
    }

    // MARK: - Storage & crypto

    private static func save(_ tokens: Tokens) {
        guard let data = try? JSONEncoder().encode(tokens),
              let text = String(data: data, encoding: .utf8) else { return }
        Keychain.set(text, for: "fuel-tokens")
    }

    private static func load() -> Tokens? {
        guard let text = Keychain.get("fuel-tokens"), !text.isEmpty,
              let data = text.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Tokens.self, from: data)
    }

    private static func randomURLSafe(_ bytes: Int) -> String {
        var raw = [UInt8](repeating: 0, count: bytes)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes, &raw)
        return Data(raw).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Apple's nonce is the hex digest.
    private static func sha256(_ value: String) -> String {
        let digest = SHA256.hash(data: Data(value.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// PKCE's code_challenge is base64url of the raw digest — a different encoding of
    /// the same hash, and mixing them up fails only at redemption time.
    private static func s256(_ verifier: String) -> String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension SignIn: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding,
                  ASWebAuthenticationPresentationContextProviding {
    nonisolated func authorizationController(controller: ASAuthorizationController,
                                             didCompleteWithAuthorization authorization: ASAuthorization) {
        Task { @MainActor in
            if let credential = authorization.credential as? ASAuthorizationAppleIDCredential {
                appleContinuation?.resume(returning: credential)
            } else {
                appleContinuation?.resume(throwing: NSError(domain: "Fuel", code: 6))
            }
            appleContinuation = nil
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController,
                                             didCompleteWithError error: Error) {
        Task { @MainActor in
            appleContinuation?.resume(throwing: error)
            appleContinuation = nil
        }
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated { Self.anchor() }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { Self.anchor() }
    }

    @MainActor
    private static func anchor() -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first?.keyWindow ?? ASPresentationAnchor()
    }
}
