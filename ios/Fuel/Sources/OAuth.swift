import Foundation
import AuthenticationServices
import CryptoKit

// Sign in with the same OAuth server the website already runs for MCP clients:
// dynamic client registration, authorization code + PKCE, refresh tokens, and the
// fuel:read / fuel:write scopes. No pasted token, and the app never sees a password —
// the Google sign-in and the consent screen both happen in the system browser.

@MainActor
@Observable
final class OAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    struct Tokens: Codable {
        var accessToken: String
        var refreshToken: String?
        var expiresAt: Date

        var isFresh: Bool { expiresAt > Date().addingTimeInterval(60) }
    }

    private(set) var tokens: Tokens?
    private(set) var signingIn = false
    var error: String?

    var isSignedIn: Bool { tokens != nil }

    private var baseURL: String
    private var clientID: String?
    private var webSession: ASWebAuthenticationSession?

    /// The custom scheme registered in Info.plist. The authorization server sends the
    /// code back to it, which is how a native app closes the loop without a web server.
    private let redirectURI = "fuel://oauth/callback"

    init(baseURL: String) {
        self.baseURL = baseURL
        super.init()
        tokens = Self.loadTokens()
        clientID = UserDefaults.standard.string(forKey: "oauthClientID")
    }

    func updateBaseURL(_ url: String) { baseURL = url }

    // MARK: - Sign in

    func signIn() async {
        signingIn = true
        error = nil
        defer { signingIn = false }
        do {
            let clientID = try await registeredClientID()
            let verifier = Self.randomURLSafe(64)
            let challenge = Self.s256(verifier)

            var components = URLComponents(string: baseURL + "/oauth/authorize")!
            components.queryItems = [
                .init(name: "response_type", value: "code"),
                .init(name: "client_id", value: clientID),
                .init(name: "redirect_uri", value: redirectURI),
                .init(name: "scope", value: "fuel:read fuel:write"),
                .init(name: "code_challenge", value: challenge),
                .init(name: "code_challenge_method", value: "S256"),
                .init(name: "state", value: Self.randomURLSafe(16)),
            ]

            let callback = try await authorize(url: components.url!)
            guard let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "code" })?.value else {
                throw NSError(domain: "Fuel", code: 1,
                              userInfo: [NSLocalizedDescriptionKey: "The sign-in did not return an authorization code."])
            }
            try await exchange(code: code, verifier: verifier, clientID: clientID)
        } catch {
            // A user tapping Cancel is not a failure worth shouting about.
            if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { return }
            self.error = error.localizedDescription
        }
    }

    func signOut() {
        tokens = nil
        Keychain.set("", for: "fuel-oauth-tokens")
    }

    /// A valid access token, refreshed if it has aged out.
    func accessToken() async -> String? {
        guard let tokens else { return nil }
        if tokens.isFresh { return tokens.accessToken }
        guard let refresh = tokens.refreshToken, let clientID else { return nil }
        try? await exchange(refreshToken: refresh, clientID: clientID)
        return self.tokens?.accessToken
    }

    // MARK: - Plumbing

    /// Dynamic client registration, once per install. The server hands back a client_id
    /// for a public client, which is why there is no secret anywhere in this app.
    private func registeredClientID() async throws -> String {
        if let clientID { return clientID }
        var request = URLRequest(url: URL(string: baseURL + "/oauth/register")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "client_name": "Fuel for iOS",
            "redirect_uris": [redirectURI],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "scope": "fuel:read fuel:write",
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = object["client_id"] as? String else {
            let detail = String(data: data.prefix(200), encoding: .utf8) ?? ""
            throw NSError(domain: "Fuel", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Could not register with Fuel. \(detail)"])
        }
        clientID = id
        UserDefaults.standard.set(id, forKey: "oauthClientID")
        return id
    }

    private func authorize(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "fuel") { callback, error in
                if let error { continuation.resume(throwing: error) }
                else if let callback { continuation.resume(returning: callback) }
                else { continuation.resume(throwing: NSError(domain: "Fuel", code: 3)) }
            }
            session.presentationContextProvider = self
            // A fresh session each time, so signing in as a different account works.
            session.prefersEphemeralWebBrowserSession = false
            webSession = session
            session.start()
        }
    }

    private func exchange(code: String, verifier: String, clientID: String) async throws {
        try await token(form: [
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirectURI,
            "client_id": clientID,
            "code_verifier": verifier,
        ])
    }

    private func exchange(refreshToken: String, clientID: String) async throws {
        try await token(form: [
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
            "client_id": clientID,
        ])
    }

    private func token(form: [String: String]) async throws {
        var request = URLRequest(url: URL(string: baseURL + "/oauth/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = form
            .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? $0.value)" }
            .joined(separator: "&").data(using: .utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = object["access_token"] as? String else {
            let detail = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error_description"] as? String
                ?? String(data: data.prefix(200), encoding: .utf8) ?? "unknown error"
            throw NSError(domain: "Fuel", code: 4, userInfo: [NSLocalizedDescriptionKey: detail])
        }
        let lifetime = (object["expires_in"] as? Double) ?? 3600
        let next = Tokens(accessToken: access,
                          refreshToken: object["refresh_token"] as? String ?? tokens?.refreshToken,
                          expiresAt: Date().addingTimeInterval(lifetime))
        tokens = next
        Self.save(next)
    }

    // MARK: - Storage & PKCE

    private static func save(_ tokens: Tokens) {
        guard let data = try? JSONEncoder().encode(tokens),
              let text = String(data: data, encoding: .utf8) else { return }
        Keychain.set(text, for: "fuel-oauth-tokens")
    }

    private static func loadTokens() -> Tokens? {
        guard let text = Keychain.get("fuel-oauth-tokens"), !text.isEmpty,
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

    private static func s256(_ verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return Data(digest).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.first?.keyWindow ?? ASPresentationAnchor()
        }
    }
}

import UIKit
