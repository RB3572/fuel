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

        /// Renewed five minutes early rather than one. The margin is not about clock
        /// skew — it is about which radio the refresh goes out on. A token allowed to
        /// run to the wire is first found stale when the app is opened after an hour
        /// away, on a connection that has only just woken up; renewing while the app is
        /// still in use gets it done over a network that is already working.
        var isFresh: Bool { expiresAt > Date().addingTimeInterval(5 * 60) }
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
    /// The server's refresh tokens are single-use and rotate on redemption. At launch
    /// and on foreground, several call sites ask for an access token within
    /// milliseconds of each other; each independently seeing the same stale token and
    /// racing to redeem it means only the first succeeds — the rest get an
    /// already-used refresh token, silently fail, and are left permanently stranded on
    /// the old token pair until sign-out/sign-in. Everyone joins one in-flight refresh
    /// instead of starting their own.
    private var refreshTask: Task<Void, Never>?

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

    /// A valid access token, refreshed if it has aged out. Concurrent callers during
    /// the same expiry window join one refresh rather than each redeeming the
    /// single-use refresh token themselves — see `refreshTask`.
    func accessToken() async -> String? {
        guard let tokens else { return nil }
        if tokens.isFresh { return tokens.accessToken }
        guard tokens.refreshToken != nil else { return nil }
        if let refreshTask {
            await refreshTask.value
        } else {
            let task = Task { await self.renew() }
            refreshTask = task
            await task.value
            refreshTask = nil
        }
        // A refresh that did not renew leaves the previous pair in place, and that
        // access token is known to be past its expiry. Handing it back anyway is how a
        // failed renewal used to surface as "that token was rejected": the request went
        // out with a credential the app already knew was dead, and the 401 that came
        // back described the symptom rather than the cause. Nothing is better.
        guard let current = self.tokens, current.isFresh else { return nil }
        return current.accessToken
    }

    /// What a renewal attempt concluded. Separating these two failures is the whole
    /// point: a dead grant can only be fixed by signing in again, while a connection
    /// that failed must change nothing at all. Treating the second as the first would
    /// sign the user out every time the app woke up somewhere with no bars.
    private enum Renewal { case renewed, tryAgainLater, grantIsDead }

    private func renew() async {
        guard let refresh = tokens?.refreshToken else { return }
        switch await attemptRenewal(refresh) {
        case .renewed, .tryAgainLater:
            break
        case .grantIsDead:
            // Ninety days elapsed, or a rotation the server has since aged out. Nothing
            // the app is holding can recover it, so drop the pair and let RootView show
            // the sign-in screen — which is the actual next step — instead of leaving a
            // signed-in-looking app that fails every request.
            signOut()
            error = "Your session expired. Sign in again."
        }
    }

    private func attemptRenewal(_ refreshToken: String) async -> Renewal {
        var request = URLRequest(url: URL(string: baseURL + "/oauth/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = "grant_type=refresh_token&refresh_token=\(refreshToken)&client_id=fuel-native"
            .data(using: .utf8)

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse else { return .tryAgainLater }
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]

        guard (200...299).contains(http.statusCode) else {
            // The server names a spent or expired grant exactly, as `invalid_grant`.
            // Everything else a failing request can return — a 500, a gateway's HTML
            // error page, a captive portal — is someone else's bad moment, and must not
            // cost a session that is probably still perfectly good.
            return object?["error"] as? String == "invalid_grant" ? .grantIsDead : .tryAgainLater
        }
        guard let access = object?["access_token"] as? String else { return .tryAgainLater }

        var next = tokens
        next?.accessToken = access
        next?.refreshToken = object?["refresh_token"] as? String ?? tokens?.refreshToken
        next?.expiresAt = Date().addingTimeInterval((object?["expires_in"] as? Double) ?? 3600)
        if let next { tokens = next; Self.save(next) }
        return .renewed
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

    /// Registered in Info.plist. Absent means no iOS client is configured, and the
    /// server-brokered fallback below is used instead.
    private var googleClientID: String? {
        let value = Bundle.main.object(forInfoDictionaryKey: "GoogleClientID") as? String
        return (value?.isEmpty == false && value?.hasPrefix("REPLACE") == false) ? value : nil
    }

    /// Google, natively: the system browser opens accounts.google.com, the same account
    /// picker the website shows, and the app comes back holding an ID token that Fuel
    /// verifies server-side. iOS OAuth clients are public by design — there is no secret
    /// to protect — so PKCE is what makes the exchange safe.
    ///
    /// Without an iOS client configured this falls back to the server-brokered flow,
    /// which needs no client at all. Self-hosters get one that works either way.
    func signInWithGoogle() async {
        busy = true
        error = nil
        defer { busy = false }
        guard let clientID = googleClientID else {
            await signInWithGoogleViaFuel()
            return
        }
        do {
            // Google's iOS convention: the redirect scheme is the client ID reversed.
            let scheme = "com.googleusercontent.apps." + clientID
                .replacingOccurrences(of: ".apps.googleusercontent.com", with: "")
            let redirect = "\(scheme):/oauth2redirect"
            let verifier = Self.randomURLSafe(64)

            var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
            components.queryItems = [
                .init(name: "client_id", value: clientID),
                .init(name: "redirect_uri", value: redirect),
                .init(name: "response_type", value: "code"),
                .init(name: "scope", value: "openid email profile"),
                .init(name: "code_challenge", value: Self.s256(verifier)),
                .init(name: "code_challenge_method", value: "S256"),
            ]

            let callback = try await webAuth(url: components.url!, scheme: scheme)
            guard let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "code" })?.value else {
                throw NSError(domain: "Fuel", code: 2,
                              userInfo: [NSLocalizedDescriptionKey: "Google did not return an authorization code."])
            }

            // Exchange at Google for the ID token. A public iOS client sends no secret.
            var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = [
                "client_id": clientID, "code": code, "code_verifier": verifier,
                "grant_type": "authorization_code", "redirect_uri": redirect,
            ].map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? $0.value)" }
                .joined(separator: "&").data(using: .utf8)

            let (data, _) = try await URLSession.shared.data(for: request)
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard let idToken = object?["id_token"] as? String else {
                let detail = (object?["error_description"] as? String) ?? (object?["error"] as? String)
                    ?? "Google did not return an identity token."
                throw NSError(domain: "Fuel", code: 3, userInfo: [NSLocalizedDescriptionKey: detail])
            }
            try await exchange(provider: "google", idToken: idToken, email: nil, name: nil)
        } catch {
            if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { return }
            self.error = error.localizedDescription
        }
    }

    /// The no-client fallback: open Fuel's own Google flow and take back a one-time code
    /// bound to a PKCE challenge. The user still only ever sees Google's account picker.
    private func signInWithGoogleViaFuel() async {
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
                throw NSError(domain: "Fuel", code: 4,
                              userInfo: [NSLocalizedDescriptionKey: "Google sign-in failed (\(failure))."])
            }
            guard let code = items.first(where: { $0.name == "code" })?.value else {
                throw NSError(domain: "Fuel", code: 5,
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
        if let key = scenes.first?.keyWindow { return key }
        // A window has to belong to a scene as of iOS 26. The frame-based fallback is
        // only reachable if we are asked to present with no window scene at all, which
        // means there is no UI to present over in the first place.
        guard let scene = scenes.first else {
            // Every way of making a window without a scene is deprecated as of iOS 26,
            // and there is nothing sensible to return: being asked to present sign-in
            // with no window scene means there is no UI to present over.
            fatalError("Sign-in asked for a presentation anchor with no window scene")
        }
        return UIWindow(windowScene: scene)
    }
}
