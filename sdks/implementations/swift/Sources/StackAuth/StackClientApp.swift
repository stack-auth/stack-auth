import Foundation
import Crypto
#if canImport(AuthenticationServices)
import AuthenticationServices
#endif

/// Handler URLs configuration
public struct HandlerUrls: Sendable {
    public var home: String
    public var signIn: String
    public var signUp: String
    public var signOut: String
    public var afterSignIn: String
    public var afterSignUp: String
    public var afterSignOut: String
    public var emailVerification: String
    public var passwordReset: String
    public var forgotPassword: String
    public var magicLinkCallback: String
    public var oauthCallback: String
    public var accountSettings: String
    public var onboarding: String
    public var teamInvitation: String
    public var mfa: String
    public var error: String
    
    public init(
        home: String = "/",
        signIn: String = "/handler/sign-in",
        signUp: String = "/handler/sign-up",
        signOut: String = "/handler/sign-out",
        afterSignIn: String = "/",
        afterSignUp: String = "/",
        afterSignOut: String = "/",
        emailVerification: String = "/handler/email-verification",
        passwordReset: String = "/handler/password-reset",
        forgotPassword: String = "/handler/forgot-password",
        magicLinkCallback: String = "/handler/magic-link-callback",
        oauthCallback: String = "/handler/oauth-callback",
        accountSettings: String = "/handler/account-settings",
        onboarding: String = "/handler/onboarding",
        teamInvitation: String = "/handler/team-invitation",
        mfa: String = "/handler/mfa",
        error: String = "/handler/error"
    ) {
        self.home = home
        self.signIn = signIn
        self.signUp = signUp
        self.signOut = signOut
        self.afterSignIn = afterSignIn
        self.afterSignUp = afterSignUp
        self.afterSignOut = afterSignOut
        self.emailVerification = emailVerification
        self.passwordReset = passwordReset
        self.forgotPassword = forgotPassword
        self.magicLinkCallback = magicLinkCallback
        self.oauthCallback = oauthCallback
        self.accountSettings = accountSettings
        self.onboarding = onboarding
        self.teamInvitation = teamInvitation
        self.mfa = mfa
        self.error = error
    }
}

/// OAuth URL result
public struct OAuthUrlResult: Sendable {
    public let url: URL
    public let state: String
    public let codeVerifier: String
}

/// Get user options
public enum GetUserOr: Sendable {
    case returnNull
    case redirect
    case `throw`
    case anonymous
}

/// The main Stack Auth client
public actor StackClientApp {
    public let projectId: String
    public let urls: HandlerUrls
    
    let client: APIClient
    private let baseUrl: String
    
    public init(
        projectId: String,
        publishableClientKey: String,
        baseUrl: String = "https://api.stack-auth.com",
        tokenStore: TokenStore = .keychain,
        urls: HandlerUrls = HandlerUrls(),
        noAutomaticPrefetch: Bool = false
    ) {
        self.projectId = projectId
        self.baseUrl = baseUrl
        self.urls = urls
        
        let store: any TokenStoreProtocol
        switch tokenStore {
        case .keychain:
            store = KeychainTokenStore(projectId: projectId)
        case .memory:
            store = MemoryTokenStore()
        case .explicit(let accessToken, let refreshToken):
            store = ExplicitTokenStore(accessToken: accessToken, refreshToken: refreshToken)
        case .none:
            store = NullTokenStore()
        case .custom(let customStore):
            store = customStore
        }
        
        self.client = APIClient(
            baseUrl: baseUrl,
            projectId: projectId,
            publishableClientKey: publishableClientKey,
            tokenStore: store
        )
        
        // Prefetch project info
        if !noAutomaticPrefetch {
            Task {
                _ = try? await self.getProject()
            }
        }
    }
    
    // MARK: - OAuth
    
    /// Get the OAuth authorization URL without redirecting
    public func getOAuthUrl(
        provider: String,
        redirectUrl: String? = nil,
        state: String? = nil,
        codeVerifier: String? = nil
    ) async throws -> OAuthUrlResult {
        let actualState = state ?? generateRandomString(length: 32)
        let actualCodeVerifier = codeVerifier ?? generateCodeVerifier()
        let codeChallenge = generateCodeChallenge(from: actualCodeVerifier)
        
        let callbackUrl = redirectUrl ?? urls.oauthCallback
        
        var components = URLComponents(string: "\(baseUrl)/api/v1/auth/oauth/authorize/\(provider.lowercased())")!
        let publishableKey = await client.publishableClientKey
        components.queryItems = [
            URLQueryItem(name: "client_id", value: projectId),
            URLQueryItem(name: "client_secret", value: publishableKey),
            URLQueryItem(name: "redirect_uri", value: callbackUrl),
            URLQueryItem(name: "scope", value: "legacy"),
            URLQueryItem(name: "state", value: actualState),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "type", value: "authenticate"),
            URLQueryItem(name: "error_redirect_url", value: urls.error)
        ]
        
        // Add access token if user is already logged in
        if let accessToken = await client.getAccessToken() {
            components.queryItems?.append(URLQueryItem(name: "token", value: accessToken))
        }
        
        guard let url = components.url else {
            throw StackAuthError(code: "invalid_url", message: "Failed to construct OAuth URL")
        }
        
        return OAuthUrlResult(url: url, state: actualState, codeVerifier: actualCodeVerifier)
    }
    
    #if canImport(AuthenticationServices) && !os(watchOS)
    /// Sign in with OAuth using ASWebAuthenticationSession
    @MainActor
    public func signInWithOAuth(
        provider: String,
        presentationContextProvider: ASWebAuthenticationPresentationContextProviding? = nil
    ) async throws {
        let oauth = try await getOAuthUrl(provider: provider)
        
        let callbackScheme = "stackauth-\(projectId)"
        
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let session = ASWebAuthenticationSession(
                url: oauth.url,
                callbackURLScheme: callbackScheme
            ) { callbackUrl, error in
                if let error = error {
                    if (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        continuation.resume(throwing: StackAuthError(code: "oauth_cancelled", message: "User cancelled OAuth"))
                    } else {
                        continuation.resume(throwing: OAuthError(code: "oauth_error", message: error.localizedDescription))
                    }
                    return
                }
                
                guard let callbackUrl = callbackUrl else {
                    continuation.resume(throwing: OAuthError(code: "oauth_error", message: "No callback URL received"))
                    return
                }
                
                Task {
                    do {
                        try await self.callOAuthCallback(url: callbackUrl, codeVerifier: oauth.codeVerifier)
                        continuation.resume()
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
            
            session.prefersEphemeralWebBrowserSession = false
            
            #if os(iOS) || os(macOS)
            if let provider = presentationContextProvider {
                session.presentationContextProvider = provider
            }
            #endif
            
            session.start()
        }
    }
    #endif
    
    /// Complete the OAuth flow with the callback URL
    public func callOAuthCallback(url: URL, codeVerifier: String) async throws {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        
        guard let code = components?.queryItems?.first(where: { $0.name == "code" })?.value else {
            if let error = components?.queryItems?.first(where: { $0.name == "error" })?.value {
                let description = components?.queryItems?.first(where: { $0.name == "error_description" })?.value ?? "OAuth error"
                throw OAuthError(code: error, message: description)
            }
            throw OAuthError(code: "missing_code", message: "No authorization code in callback URL")
        }
        
        // Exchange code for tokens
        let tokenUrl = URL(string: "\(baseUrl)/api/v1/auth/oauth/token")!
        var request = URLRequest(url: tokenUrl)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue(projectId, forHTTPHeaderField: "x-stack-project-id")
        
        let publishableKey = await client.publishableClientKey
        let body = [
            "grant_type=authorization_code",
            "code=\(code.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? code)",
            "redirect_uri=\(urls.oauthCallback.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? urls.oauthCallback)",
            "code_verifier=\(codeVerifier)",
            "client_id=\(projectId)",
            "client_secret=\(publishableKey)"
        ].joined(separator: "&")
        
        request.httpBody = body.data(using: .utf8)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw OAuthError(code: "invalid_response", message: "Invalid HTTP response")
        }
        
        if httpResponse.statusCode != 200 {
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let errorCode = json["error"] as? String {
                let message = json["error_description"] as? String ?? "Token exchange failed"
                throw OAuthError(code: errorCode, message: message)
            }
            throw OAuthError(code: "token_exchange_failed", message: "HTTP \(httpResponse.statusCode)")
        }
        
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let accessToken = json["access_token"] as? String else {
            throw OAuthError(code: "parse_error", message: "Failed to parse token response")
        }
        
        let refreshToken = json["refresh_token"] as? String
        await client.setTokens(accessToken: accessToken, refreshToken: refreshToken)
    }
    
    // MARK: - Credential Auth
    
    public func signInWithCredential(email: String, password: String) async throws {
        let (data, _) = try await client.sendRequest(
            path: "/auth/password/sign-in",
            method: "POST",
            body: ["email": email, "password": password]
        )
        
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let accessToken = json["access_token"] as? String,
              let refreshToken = json["refresh_token"] as? String else {
            throw StackAuthError(code: "parse_error", message: "Failed to parse sign-in response")
        }
        
        await client.setTokens(accessToken: accessToken, refreshToken: refreshToken)
    }
    
    public func signUpWithCredential(
        email: String,
        password: String,
        verificationCallbackUrl: String? = nil
    ) async throws {
        var body: [String: Any] = ["email": email, "password": password]
        if let callbackUrl = verificationCallbackUrl {
            body["verification_callback_url"] = callbackUrl
        }
        
        let (data, _) = try await client.sendRequest(
            path: "/auth/password/sign-up",
            method: "POST",
            body: body
        )
        
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let accessToken = json["access_token"] as? String,
              let refreshToken = json["refresh_token"] as? String else {
            throw StackAuthError(code: "parse_error", message: "Failed to parse sign-up response")
        }
        
        await client.setTokens(accessToken: accessToken, refreshToken: refreshToken)
    }
    
    // MARK: - Magic Link
    
    public func sendMagicLinkEmail(email: String, callbackUrl: String? = nil) async throws -> String {
        var body: [String: Any] = ["email": email]
        if let callbackUrl = callbackUrl {
            body["callback_url"] = callbackUrl
        } else {
            body["callback_url"] = urls.magicLinkCallback
        }
        
        let (data, _) = try await client.sendRequest(
            path: "/auth/otp/send-sign-in-code",
            method: "POST",
            body: body
        )
        
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let nonce = json["nonce"] as? String else {
            throw StackAuthError(code: "parse_error", message: "Failed to parse magic link response")
        }
        
        return nonce
    }
    
    public func signInWithMagicLink(code: String) async throws {
        let (data, _) = try await client.sendRequest(
            path: "/auth/otp/sign-in",
            method: "POST",
            body: ["code": code]
        )
        
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let accessToken = json["access_token"] as? String,
              let refreshToken = json["refresh_token"] as? String else {
            throw StackAuthError(code: "parse_error", message: "Failed to parse magic link sign-in response")
        }
        
        await client.setTokens(accessToken: accessToken, refreshToken: refreshToken)
    }
    
    // MARK: - MFA
    
    public func signInWithMfa(totp: String, code: String) async throws {
        let (data, _) = try await client.sendRequest(
            path: "/auth/mfa/sign-in",
            method: "POST",
            body: [
                "type": "totp",
                "totp": totp,
                "code": code
            ]
        )
        
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let accessToken = json["access_token"] as? String,
              let refreshToken = json["refresh_token"] as? String else {
            throw StackAuthError(code: "parse_error", message: "Failed to parse MFA sign-in response")
        }
        
        await client.setTokens(accessToken: accessToken, refreshToken: refreshToken)
    }
    
    // MARK: - Password Reset
    
    public func sendForgotPasswordEmail(email: String, callbackUrl: String? = nil) async throws {
        var body: [String: Any] = ["email": email]
        body["callback_url"] = callbackUrl ?? urls.passwordReset
        
        _ = try await client.sendRequest(
            path: "/auth/password/send-reset-code",
            method: "POST",
            body: body
        )
    }
    
    public func resetPassword(code: String, password: String) async throws {
        _ = try await client.sendRequest(
            path: "/auth/password/reset",
            method: "POST",
            body: ["code": code, "password": password]
        )
    }
    
    public func verifyPasswordResetCode(_ code: String) async throws {
        _ = try await client.sendRequest(
            path: "/auth/password/reset/check-code",
            method: "POST",
            body: ["code": code]
        )
    }
    
    // MARK: - Email Verification
    
    public func verifyEmail(code: String) async throws {
        _ = try await client.sendRequest(
            path: "/contact-channels/verify",
            method: "POST",
            body: ["code": code]
        )
    }
    
    // MARK: - Team Invitations
    
    public func acceptTeamInvitation(code: String) async throws {
        _ = try await client.sendRequest(
            path: "/team-invitations/accept",
            method: "POST",
            body: ["code": code],
            authenticated: true
        )
    }
    
    public func verifyTeamInvitationCode(_ code: String) async throws {
        _ = try await client.sendRequest(
            path: "/team-invitations/accept/check-code",
            method: "POST",
            body: ["code": code],
            authenticated: true
        )
    }
    
    public func getTeamInvitationDetails(code: String) async throws -> String {
        let (data, _) = try await client.sendRequest(
            path: "/team-invitations/accept/details",
            method: "POST",
            body: ["code": code],
            authenticated: true
        )
        
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let teamDisplayName = json["team_display_name"] as? String else {
            throw StackAuthError(code: "parse_error", message: "Failed to parse team invitation details")
        }
        
        return teamDisplayName
    }
    
    // MARK: - User
    
    public func getUser(or: GetUserOr = .returnNull, includeRestricted: Bool = false) async throws -> CurrentUser? {
        // Validate mutually exclusive options
        if or == .anonymous && !includeRestricted {
            throw StackAuthError(
                code: "invalid_options",
                message: "Cannot use { or: 'anonymous' } with { includeRestricted: false }"
            )
        }
        
        let includeAnonymous = or == .anonymous
        let effectiveIncludeRestricted = includeRestricted || includeAnonymous
        
        // Check if we have tokens
        let hasTokens = await client.getAccessToken() != nil
        
        if !hasTokens {
            switch or {
            case .returnNull:
                return nil
            case .redirect:
                throw StackAuthError(code: "redirect_not_supported", message: "Redirects are not supported in Swift SDK")
            case .throw:
                throw UserNotSignedInError()
            case .anonymous:
                try await signUpAnonymously()
            }
        }
        
        do {
            let (data, _) = try await client.sendRequest(
                path: "/users/me",
                method: "GET",
                authenticated: true
            )
            
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return nil
            }
            
            let user = CurrentUser(client: client, json: json)
            
            // Check if we should return this user
            if await user.isAnonymous && !includeAnonymous {
                return handleNoUser(or: or)
            }
            
            if await user.isRestricted && !effectiveIncludeRestricted {
                return handleNoUser(or: or)
            }
            
            return user
            
        } catch {
            return handleNoUser(or: or)
        }
    }
    
    private func handleNoUser(or: GetUserOr) -> CurrentUser? {
        switch or {
        case .returnNull, .anonymous:
            return nil
        case .redirect:
            // Can't redirect in Swift
            return nil
        case .throw:
            // Already thrown
            return nil
        }
    }
    
    private func signUpAnonymously() async throws {
        let (data, _) = try await client.sendRequest(
            path: "/auth/anonymous/sign-up",
            method: "POST"
        )
        
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let accessToken = json["access_token"] as? String,
              let refreshToken = json["refresh_token"] as? String else {
            throw StackAuthError(code: "parse_error", message: "Failed to parse anonymous sign-up response")
        }
        
        await client.setTokens(accessToken: accessToken, refreshToken: refreshToken)
    }
    
    // MARK: - Project
    
    public func getProject() async throws -> Project {
        let (data, _) = try await client.sendRequest(
            path: "/projects/current",
            method: "GET"
        )
        
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw StackAuthError(code: "parse_error", message: "Failed to parse project response")
        }
        
        return Project(from: json)
    }
    
    // MARK: - Partial User
    
    public func getPartialUser() async -> TokenPartialUser? {
        guard let accessToken = await client.getAccessToken() else {
            return nil
        }
        
        // Decode JWT
        let parts = accessToken.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        
        var base64 = String(parts[1])
        // Add padding if needed
        while base64.count % 4 != 0 {
            base64 += "="
        }
        // Replace URL-safe characters
        base64 = base64.replacingOccurrences(of: "-", with: "+")
        base64 = base64.replacingOccurrences(of: "_", with: "/")
        
        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        
        var restrictedReason: User.RestrictedReason? = nil
        if let reason = json["restricted_reason"] as? [String: Any],
           let type = reason["type"] as? String {
            restrictedReason = User.RestrictedReason(type: type)
        }
        
        return TokenPartialUser(
            id: json["sub"] as? String ?? "",
            displayName: json["name"] as? String,
            primaryEmail: json["email"] as? String,
            primaryEmailVerified: json["email_verified"] as? Bool ?? false,
            isAnonymous: json["is_anonymous"] as? Bool ?? false,
            isRestricted: json["is_restricted"] as? Bool ?? false,
            restrictedReason: restrictedReason
        )
    }
    
    // MARK: - Sign Out
    
    public func signOut() async throws {
        _ = try? await client.sendRequest(
            path: "/auth/sessions/current",
            method: "DELETE",
            authenticated: true
        )
        await client.clearTokens()
    }
    
    // MARK: - Tokens
    
    public func getAccessToken() async -> String? {
        return await client.getAccessToken()
    }
    
    public func getRefreshToken() async -> String? {
        return await client.getRefreshToken()
    }
    
    public func getAuthHeaders() async -> [String: String] {
        let accessToken = await client.getAccessToken()
        let refreshToken = await client.getRefreshToken()
        
        let json: [String: Any?] = [
            "accessToken": accessToken,
            "refreshToken": refreshToken
        ]
        
        if let data = try? JSONSerialization.data(withJSONObject: json),
           let string = String(data: data, encoding: .utf8) {
            return ["x-stack-auth": string]
        }
        
        return ["x-stack-auth": "{}"]
    }
    
    // MARK: - PKCE Helpers
    
    private func generateRandomString(length: Int) -> String {
        let characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        return String((0..<length).map { _ in characters.randomElement()! })
    }
    
    private func generateCodeVerifier() -> String {
        return generateRandomString(length: 64)
    }
    
    private func generateCodeChallenge(from verifier: String) -> String {
        let data = Data(verifier.utf8)
        let hash = SHA256.hash(data: data)
        let base64 = Data(hash).base64EncodedString()
        
        // Convert to base64url
        return base64
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
