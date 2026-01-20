import Foundation
#if canImport(Security)
import Security
#endif

/// Protocol for custom token storage implementations
public protocol TokenStoreProtocol: Sendable {
    func getAccessToken() async -> String?
    func getRefreshToken() async -> String?
    func setTokens(accessToken: String?, refreshToken: String?) async
    func clearTokens() async
}

/// Token storage configuration
public enum TokenStore: Sendable {
    #if canImport(Security)
    /// Store tokens in Keychain (default, secure, persists across launches)
    /// Only available on Apple platforms (iOS, macOS, etc.)
    case keychain
    #endif
    
    /// Store tokens in memory (lost on app restart)
    case memory
    
    /// Explicit tokens (for server-side usage)
    case explicit(accessToken: String, refreshToken: String)
    
    /// No token storage
    case none
    
    /// Custom storage implementation
    case custom(any TokenStoreProtocol)
}

// MARK: - Keychain Token Store (Apple platforms only)

#if canImport(Security)
actor KeychainTokenStore: TokenStoreProtocol {
    private let projectId: String
    private let accessTokenKey: String
    private let refreshTokenKey: String
    
    init(projectId: String) {
        self.projectId = projectId
        self.accessTokenKey = "stack-auth-access-\(projectId)"
        self.refreshTokenKey = "stack-auth-refresh-\(projectId)"
    }
    
    func getAccessToken() async -> String? {
        return getKeychainItem(key: accessTokenKey)
    }
    
    func getRefreshToken() async -> String? {
        return getKeychainItem(key: refreshTokenKey)
    }
    
    func setTokens(accessToken: String?, refreshToken: String?) async {
        if let accessToken = accessToken {
            setKeychainItem(key: accessTokenKey, value: accessToken)
        } else {
            deleteKeychainItem(key: accessTokenKey)
        }
        
        if let refreshToken = refreshToken {
            setKeychainItem(key: refreshTokenKey, value: refreshToken)
        } else {
            deleteKeychainItem(key: refreshTokenKey)
        }
    }
    
    func clearTokens() async {
        deleteKeychainItem(key: accessTokenKey)
        deleteKeychainItem(key: refreshTokenKey)
    }
    
    // MARK: - Keychain Helpers
    
    private func getKeychainItem(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        guard status == errSecSuccess,
              let data = result as? Data,
              let string = String(data: data, encoding: .utf8) else {
            return nil
        }
        
        return string
    }
    
    private func setKeychainItem(key: String, value: String) {
        guard let data = value.data(using: .utf8) else { return }
        
        // First try to update
        let updateQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key
        ]
        
        let attributes: [String: Any] = [
            kSecValueData as String: data
        ]
        
        let updateStatus = SecItemUpdate(updateQuery as CFDictionary, attributes as CFDictionary)
        
        if updateStatus == errSecItemNotFound {
            // Item doesn't exist, add it
            let addQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: key,
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
            ]
            
            SecItemAdd(addQuery as CFDictionary, nil)
        }
    }
    
    private func deleteKeychainItem(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key
        ]
        
        SecItemDelete(query as CFDictionary)
    }
}
#endif

// MARK: - Memory Token Store

actor MemoryTokenStore: TokenStoreProtocol {
    private var accessToken: String?
    private var refreshToken: String?
    
    func getAccessToken() async -> String? {
        return accessToken
    }
    
    func getRefreshToken() async -> String? {
        return refreshToken
    }
    
    func setTokens(accessToken: String?, refreshToken: String?) async {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
    }
    
    func clearTokens() async {
        self.accessToken = nil
        self.refreshToken = nil
    }
}

// MARK: - Explicit Token Store

actor ExplicitTokenStore: TokenStoreProtocol {
    private let accessToken: String
    private let refreshToken: String
    
    init(accessToken: String, refreshToken: String) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
    }
    
    func getAccessToken() async -> String? {
        return accessToken
    }
    
    func getRefreshToken() async -> String? {
        return refreshToken
    }
    
    func setTokens(accessToken: String?, refreshToken: String?) async {
        // Explicit tokens are immutable
    }
    
    func clearTokens() async {
        // Explicit tokens are immutable
    }
}

// MARK: - Null Token Store

actor NullTokenStore: TokenStoreProtocol {
    func getAccessToken() async -> String? { nil }
    func getRefreshToken() async -> String? { nil }
    func setTokens(accessToken: String?, refreshToken: String?) async {}
    func clearTokens() async {}
}
