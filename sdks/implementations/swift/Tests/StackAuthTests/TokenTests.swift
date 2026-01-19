import Testing
import Foundation
@testable import StackAuth

@Suite("Token Storage Tests")
struct TokenStorageTests {
    
    // MARK: - Memory Token Store Tests
    
    @Test("Should store tokens in memory")
    func memoryTokenStore() async throws {
        let app = TestConfig.createClientApp(tokenStore: .memory)
        let email = TestConfig.uniqueEmail()
        
        try await app.signUpWithCredential(email: email, password: TestConfig.testPassword)
        
        let accessToken = await app.getAccessToken()
        let refreshToken = await app.getRefreshToken()
        
        #expect(accessToken != nil)
        #expect(refreshToken != nil)
        #expect(!accessToken!.isEmpty)
        #expect(!refreshToken!.isEmpty)
    }
    
    @Test("Should clear memory tokens on sign out")
    func memoryTokensClearedOnSignOut() async throws {
        let app = TestConfig.createClientApp(tokenStore: .memory)
        let email = TestConfig.uniqueEmail()
        
        try await app.signUpWithCredential(email: email, password: TestConfig.testPassword)
        
        let tokenBefore = await app.getAccessToken()
        #expect(tokenBefore != nil)
        
        try await app.signOut()
        
        let tokenAfter = await app.getAccessToken()
        #expect(tokenAfter == nil)
    }
    
    // MARK: - Explicit Token Store Tests
    
    @Test("Should use explicitly provided tokens")
    func explicitTokenStore() async throws {
        // First, get real tokens
        let app1 = TestConfig.createClientApp(tokenStore: .memory)
        let email = TestConfig.uniqueEmail()
        
        try await app1.signUpWithCredential(email: email, password: TestConfig.testPassword)
        
        let accessToken = await app1.getAccessToken()
        let refreshToken = await app1.getRefreshToken()
        
        #expect(accessToken != nil)
        #expect(refreshToken != nil)
        
        // Now use explicit store with those tokens
        let app2 = StackClientApp(
            projectId: testProjectId,
            publishableClientKey: testPublishableClientKey,
            baseUrl: baseUrl,
            tokenStore: .explicit(accessToken: accessToken!, refreshToken: refreshToken!),
            noAutomaticPrefetch: true
        )
        
        let user = try await app2.getUser()
        #expect(user != nil)
        
        let userEmail = await user?.primaryEmail
        #expect(userEmail == email)
    }
    
    @Test("Should work with both tokens provided")
    func explicitBothTokens() async throws {
        // Get real tokens
        let app1 = TestConfig.createClientApp(tokenStore: .memory)
        let email = TestConfig.uniqueEmail()
        
        try await app1.signUpWithCredential(email: email, password: TestConfig.testPassword)
        
        let accessToken = await app1.getAccessToken()
        let refreshToken = await app1.getRefreshToken()
        #expect(accessToken != nil)
        #expect(refreshToken != nil)
        
        // Use both tokens
        let app2 = StackClientApp(
            projectId: testProjectId,
            publishableClientKey: testPublishableClientKey,
            baseUrl: baseUrl,
            tokenStore: .explicit(accessToken: accessToken!, refreshToken: refreshToken!),
            noAutomaticPrefetch: true
        )
        
        // Should work for requests
        let user = try await app2.getUser()
        #expect(user != nil)
    }
    
    // MARK: - Token Format Tests
    
    @Test("Should return JWT format access token")
    func accessTokenIsJwt() async throws {
        let app = TestConfig.createClientApp()
        let email = TestConfig.uniqueEmail()
        
        try await app.signUpWithCredential(email: email, password: TestConfig.testPassword)
        
        let accessToken = await app.getAccessToken()
        #expect(accessToken != nil)
        
        // JWT has three parts separated by dots
        let parts = accessToken!.split(separator: ".")
        #expect(parts.count == 3)
    }
    
    @Test("Should return refresh token in correct format")
    func refreshTokenFormat() async throws {
        let app = TestConfig.createClientApp()
        let email = TestConfig.uniqueEmail()
        
        try await app.signUpWithCredential(email: email, password: TestConfig.testPassword)
        
        let refreshToken = await app.getRefreshToken()
        #expect(refreshToken != nil)
        #expect(!refreshToken!.isEmpty)
        // Refresh token should be a reasonable length
        #expect(refreshToken!.count > 10)
    }
    
    // MARK: - Auth Headers Tests
    
    @Test("Should generate auth headers with token")
    func authHeadersWithToken() async throws {
        let app = TestConfig.createClientApp()
        let email = TestConfig.uniqueEmail()
        
        try await app.signUpWithCredential(email: email, password: TestConfig.testPassword)
        
        let headers = await app.getAuthHeaders()
        
        #expect(headers["x-stack-auth"] != nil)
        #expect(!headers["x-stack-auth"]!.isEmpty)
    }
    
    @Test("Should generate consistent auth headers format")
    func authHeadersFormat() async throws {
        let app = TestConfig.createClientApp()
        let email = TestConfig.uniqueEmail()
        
        try await app.signUpWithCredential(email: email, password: TestConfig.testPassword)
        
        let headers = await app.getAuthHeaders()
        
        // When authenticated, x-stack-auth should be present and contain the token
        let authHeader = headers["x-stack-auth"]
        #expect(authHeader != nil)
        #expect(!authHeader!.isEmpty)
    }
    
    // MARK: - Partial User from Token Tests
    
    @Test("Should get partial user from token without API call")
    func partialUserFromToken() async throws {
        let app = TestConfig.createClientApp()
        let email = TestConfig.uniqueEmail()
        
        try await app.signUpWithCredential(email: email, password: TestConfig.testPassword)
        
        let partialUser = await app.getPartialUser()
        
        #expect(partialUser != nil)
        #expect(partialUser?.id != nil)
        #expect(partialUser?.primaryEmail == email)
    }
    
    @Test("Should return nil partial user when not authenticated")
    func partialUserWhenNotAuthenticated() async throws {
        let app = TestConfig.createClientApp()
        
        let partialUser = await app.getPartialUser()
        
        #expect(partialUser == nil)
    }
    
    // MARK: - Token Persistence Between Apps
    
    @Test("Should share tokens between app instances with same store")
    func shareTokensBetweenApps() async throws {
        // Get tokens from first app
        let app1 = TestConfig.createClientApp(tokenStore: .memory)
        let email = TestConfig.uniqueEmail()
        
        try await app1.signUpWithCredential(email: email, password: TestConfig.testPassword)
        
        let accessToken = await app1.getAccessToken()
        let refreshToken = await app1.getRefreshToken()
        
        // Create second app with explicit tokens
        let app2 = StackClientApp(
            projectId: testProjectId,
            publishableClientKey: testPublishableClientKey,
            baseUrl: baseUrl,
            tokenStore: .explicit(accessToken: accessToken!, refreshToken: refreshToken!),
            noAutomaticPrefetch: true
        )
        
        // Both should have same user
        let user1 = try await app1.getUser()
        let user2 = try await app2.getUser()
        
        let id1 = await user1?.id
        let id2 = await user2?.id
        
        #expect(id1 == id2)
    }
    
    // MARK: - Null Token Store Tests
    
    @Test("Should work with null token store for anonymous requests")
    func nullTokenStore() async throws {
        let app = StackClientApp(
            projectId: testProjectId,
            publishableClientKey: testPublishableClientKey,
            baseUrl: baseUrl,
            tokenStore: .none,
            noAutomaticPrefetch: true
        )
        
        // Should be able to get project without authentication
        let project = try await app.getProject()
        #expect(project.id == testProjectId)
        
        // User should be nil
        let user = try await app.getUser()
        #expect(user == nil)
    }
}
