import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Character set for form-urlencoded values.
/// Only unreserved characters (RFC 3986) are allowed; everything else must be percent-encoded.
/// This is stricter than urlQueryAllowed which incorrectly allows &, =, + etc.
private let formURLEncodedAllowedCharacters: CharacterSet = {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    return allowed
}()

/// Percent-encode a string for use in application/x-www-form-urlencoded data
func formURLEncode(_ string: String) -> String {
    return string.addingPercentEncoding(withAllowedCharacters: formURLEncodedAllowedCharacters) ?? string
}

/// Internal API client for making HTTP requests to Stack Auth
actor APIClient {
    let baseUrl: String
    let projectId: String
    let publishableClientKey: String
    let secretServerKey: String?
    private let tokenStore: any TokenStoreProtocol
    private var isRefreshing = false
    private var refreshWaiters: [CheckedContinuation<Void, Never>] = []
    
    private static let sdkVersion = "1.0.0"
    
    init(
        baseUrl: String,
        projectId: String,
        publishableClientKey: String,
        secretServerKey: String? = nil,
        tokenStore: any TokenStoreProtocol
    ) {
        self.baseUrl = baseUrl.hasSuffix("/") ? String(baseUrl.dropLast()) : baseUrl
        self.projectId = projectId
        self.publishableClientKey = publishableClientKey
        self.secretServerKey = secretServerKey
        self.tokenStore = tokenStore
    }
    
    // MARK: - Request Methods
    
    func sendRequest(
        path: String,
        method: String = "GET",
        body: [String: Any]? = nil,
        authenticated: Bool = false,
        serverOnly: Bool = false,
        tokenStoreOverride: (any TokenStoreProtocol)? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        let effectiveTokenStore = tokenStoreOverride ?? tokenStore
        guard let url = URL(string: "\(baseUrl)/api/v1\(path)") else {
            throw StackAuthError(code: "INVALID_URL", message: "Failed to construct request URL from base: \(baseUrl) and path: \(path)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        
        // Required headers
        request.setValue(projectId, forHTTPHeaderField: "x-stack-project-id")
        request.setValue(publishableClientKey, forHTTPHeaderField: "x-stack-publishable-client-key")
        request.setValue("swift@\(Self.sdkVersion)", forHTTPHeaderField: "x-stack-client-version")
        request.setValue(serverOnly ? "server" : "client", forHTTPHeaderField: "x-stack-access-type")
        request.setValue("true", forHTTPHeaderField: "x-stack-override-error-status")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "x-stack-random-nonce")
        
        // Server key if required
        if serverOnly {
            guard let serverKey = secretServerKey else {
                throw StackAuthError(code: "missing_server_key", message: "Server key required for this operation")
            }
            request.setValue(serverKey, forHTTPHeaderField: "x-stack-secret-server-key")
        }
        
        // Auth headers
        if authenticated {
            if let accessToken = await effectiveTokenStore.getAccessToken() {
                request.setValue(accessToken, forHTTPHeaderField: "x-stack-access-token")
            }
            if let refreshToken = await effectiveTokenStore.getRefreshToken() {
                request.setValue(refreshToken, forHTTPHeaderField: "x-stack-refresh-token")
            }
        }
        
        // Body - always include for mutating methods
        if let body = body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } else if method == "POST" || method == "PATCH" || method == "PUT" {
            // POST/PATCH/PUT requests need a body even if empty
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = "{}".data(using: .utf8)
        }
        
        // Send request with retry logic
        return try await sendWithRetry(request: request, authenticated: authenticated, tokenStore: effectiveTokenStore)
    }
    
    private func sendWithRetry(
        request: URLRequest,
        authenticated: Bool,
        tokenStore: any TokenStoreProtocol,
        attempt: Int = 0
    ) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw StackAuthError(code: "invalid_response", message: "Invalid HTTP response")
            }
            
            // Check for actual status code in header
            let actualStatus: Int
            if let statusHeader = httpResponse.value(forHTTPHeaderField: "x-stack-actual-status"),
               let status = Int(statusHeader) {
                actualStatus = status
            } else {
                actualStatus = httpResponse.statusCode
            }
            
            // Handle 401 with token refresh
            if actualStatus == 401 && authenticated {
                // Check if it's an invalid access token error
                if let errorCode = httpResponse.value(forHTTPHeaderField: "x-stack-known-error"),
                   errorCode == "invalid_access_token" {
                    // Try to refresh token
                    let refreshed = try await refreshTokenIfNeeded(tokenStore: tokenStore)
                    if refreshed {
                        // Retry with new token
                        var newRequest = request
                        if let accessToken = await tokenStore.getAccessToken() {
                            newRequest.setValue(accessToken, forHTTPHeaderField: "x-stack-access-token")
                        }
                        return try await sendWithRetry(request: newRequest, authenticated: authenticated, tokenStore: tokenStore, attempt: 0)
                    }
                }
            }
            
            // Handle rate limiting (max 5 retries)
            if actualStatus == 429 && attempt < 5 {
                if let retryAfter = httpResponse.value(forHTTPHeaderField: "Retry-After"),
                   let seconds = Double(retryAfter) {
                    // Use Retry-After header if provided
                    try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                } else {
                    // No Retry-After header: use exponential backoff (1s, 2s, 4s, 8s, 16s)
                    let delayMs = 1000.0 * pow(2.0, Double(attempt))
                    try await Task.sleep(nanoseconds: UInt64(delayMs * 1_000_000))
                }
                return try await sendWithRetry(request: request, authenticated: authenticated, tokenStore: tokenStore, attempt: attempt + 1)
            }
            
            // Rate limit exhausted after max retries
            if actualStatus == 429 {
                throw StackAuthError(code: "RATE_LIMITED", message: "Too many requests, please try again later")
            }
            
            // Check for known error
            if let errorCode = httpResponse.value(forHTTPHeaderField: "x-stack-known-error") {
                let errorData = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                let message = errorData?["message"] as? String ?? "Unknown error"
                let details = errorData?["details"] as? [String: Any]
                throw StackAuthError.from(code: errorCode, message: message, details: details)
            }
            
            // Success
            if actualStatus >= 200 && actualStatus < 300 {
                return (data, httpResponse)
            }
            
            // Other error
            throw StackAuthError(code: "http_error", message: "HTTP \(actualStatus)")
            
        } catch let error as URLError {
            // Network error - retry for idempotent requests
            let idempotent = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"].contains(request.httpMethod ?? "")
            if idempotent && attempt < 5 {
                let delay = pow(2.0, Double(attempt)) * 1.0 // Exponential backoff
                try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                return try await sendWithRetry(request: request, authenticated: authenticated, tokenStore: tokenStore, attempt: attempt + 1)
            }
            throw StackAuthError(code: "network_error", message: error.localizedDescription)
        }
    }
    
    // MARK: - Token Refresh
    
    private func refreshTokenIfNeeded(tokenStore: any TokenStoreProtocol) async throws -> Bool {
        // Wait if already refreshing
        if isRefreshing {
            await withCheckedContinuation { continuation in
                refreshWaiters.append(continuation)
            }
            return await tokenStore.getAccessToken() != nil
        }
        
        guard let refreshToken = await tokenStore.getRefreshToken() else {
            return false
        }
        
        isRefreshing = true
        defer {
            isRefreshing = false
            for waiter in refreshWaiters {
                waiter.resume()
            }
            refreshWaiters.removeAll()
        }
        
        // Build token refresh request
        let url = URL(string: "\(baseUrl)/api/v1/auth/oauth/token")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue(projectId, forHTTPHeaderField: "x-stack-project-id")
        request.setValue(publishableClientKey, forHTTPHeaderField: "x-stack-publishable-client-key")
        
        let body = [
            "grant_type=refresh_token",
            "refresh_token=\(formURLEncode(refreshToken))",
            "client_id=\(formURLEncode(projectId))",
            "client_secret=\(formURLEncode(publishableClientKey))"
        ].joined(separator: "&")
        
        request.httpBody = body.data(using: .utf8)
        
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                // Refresh failed - clear tokens
                await tokenStore.clearTokens()
                return false
            }
            
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let newAccessToken = json["access_token"] as? String else {
                await tokenStore.clearTokens()
                return false
            }
            
            let newRefreshToken = json["refresh_token"] as? String
            await tokenStore.setTokens(
                accessToken: newAccessToken,
                refreshToken: newRefreshToken ?? refreshToken
            )
            
            return true
        } catch {
            await tokenStore.clearTokens()
            return false
        }
    }
    
    // MARK: - Token Management
    
    func setTokens(accessToken: String?, refreshToken: String?) async {
        await tokenStore.setTokens(accessToken: accessToken, refreshToken: refreshToken)
    }
    
    func setTokens(accessToken: String?, refreshToken: String?, tokenStoreOverride: any TokenStoreProtocol) async {
        await tokenStoreOverride.setTokens(accessToken: accessToken, refreshToken: refreshToken)
    }
    
    func clearTokens() async {
        await tokenStore.clearTokens()
    }
    
    func clearTokens(tokenStoreOverride: any TokenStoreProtocol) async {
        await tokenStoreOverride.clearTokens()
    }
    
    func getAccessToken() async -> String? {
        return await tokenStore.getAccessToken()
    }
    
    func getAccessToken(tokenStoreOverride: any TokenStoreProtocol) async -> String? {
        return await tokenStoreOverride.getAccessToken()
    }
    
    func getRefreshToken() async -> String? {
        return await tokenStore.getRefreshToken()
    }
    
    func getRefreshToken(tokenStoreOverride: any TokenStoreProtocol) async -> String? {
        return await tokenStoreOverride.getRefreshToken()
    }
}

// MARK: - JSON Parsing Helpers

extension APIClient {
    func parseJSON<T>(_ data: Data) throws -> T {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? T else {
            throw StackAuthError(code: "parse_error", message: "Failed to parse response")
        }
        return json
    }
}
