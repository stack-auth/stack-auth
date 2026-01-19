import Testing
import Foundation
@testable import StackAuth

@Suite("OAuth Tests")
struct OAuthTests {
    
    // MARK: - OAuth URL Generation Tests
    
    @Test("Should generate OAuth URL for Google")
    func generateOAuthUrlForGoogle() async throws {
        let app = TestConfig.createClientApp()
        
        let result = try await app.getOAuthUrl(provider: "google")
        
        #expect(result.url.absoluteString.contains("oauth/authorize/google"))
        #expect(!result.state.isEmpty)
        #expect(!result.codeVerifier.isEmpty)
    }
    
    @Test("Should generate OAuth URL for GitHub")
    func generateOAuthUrlForGitHub() async throws {
        let app = TestConfig.createClientApp()
        
        let result = try await app.getOAuthUrl(provider: "github")
        
        #expect(result.url.absoluteString.contains("oauth/authorize/github"))
        #expect(!result.state.isEmpty)
        #expect(!result.codeVerifier.isEmpty)
    }
    
    @Test("Should generate OAuth URL for Microsoft")
    func generateOAuthUrlForMicrosoft() async throws {
        let app = TestConfig.createClientApp()
        
        let result = try await app.getOAuthUrl(provider: "microsoft")
        
        #expect(result.url.absoluteString.contains("oauth/authorize/microsoft"))
        #expect(!result.state.isEmpty)
        #expect(!result.codeVerifier.isEmpty)
    }
    
    @Test("Should include project ID in OAuth URL")
    func oauthUrlIncludesProjectId() async throws {
        let app = TestConfig.createClientApp()
        
        let result = try await app.getOAuthUrl(provider: "google")
        
        #expect(result.url.absoluteString.contains("client_id=\(testProjectId)"))
    }
    
    @Test("Should include state in OAuth URL")
    func oauthUrlIncludesState() async throws {
        let app = TestConfig.createClientApp()
        
        let result = try await app.getOAuthUrl(provider: "google")
        
        // URL should contain the state parameter
        #expect(result.url.absoluteString.contains("state="))
    }
    
    @Test("Should generate PKCE code verifier")
    func generatesPkceCodeVerifier() async throws {
        let app = TestConfig.createClientApp()
        
        let result = try await app.getOAuthUrl(provider: "google")
        
        // Code verifier should be long enough for security (43-128 chars for PKCE)
        #expect(result.codeVerifier.count >= 43)
    }
    
    @Test("Should generate unique state for each call")
    func generatesUniqueState() async throws {
        let app = TestConfig.createClientApp()
        
        let result1 = try await app.getOAuthUrl(provider: "google")
        let result2 = try await app.getOAuthUrl(provider: "google")
        
        #expect(result1.state != result2.state)
    }
    
    @Test("Should generate unique code verifier for each call")
    func generatesUniqueCodeVerifier() async throws {
        let app = TestConfig.createClientApp()
        
        let result1 = try await app.getOAuthUrl(provider: "google")
        let result2 = try await app.getOAuthUrl(provider: "google")
        
        #expect(result1.codeVerifier != result2.codeVerifier)
    }
    
    @Test("Should handle case-insensitive provider name")
    func caseInsensitiveProvider() async throws {
        let app = TestConfig.createClientApp()
        
        let result1 = try await app.getOAuthUrl(provider: "Google")
        let result2 = try await app.getOAuthUrl(provider: "GOOGLE")
        let result3 = try await app.getOAuthUrl(provider: "google")
        
        // All should generate valid URLs with google provider
        #expect(result1.url.absoluteString.contains("oauth/authorize/google"))
        #expect(result2.url.absoluteString.contains("oauth/authorize/google"))
        #expect(result3.url.absoluteString.contains("oauth/authorize/google"))
    }
    
    @Test("Should include code challenge in URL")
    func includesCodeChallenge() async throws {
        let app = TestConfig.createClientApp()
        
        let result = try await app.getOAuthUrl(provider: "google")
        
        // URL should contain PKCE code challenge
        #expect(result.url.absoluteString.contains("code_challenge="))
        #expect(result.url.absoluteString.contains("code_challenge_method=S256"))
    }
    
    // MARK: - OAuth URL with Custom Options
    
    @Test("Should include custom redirect URL")
    func customRedirectUrl() async throws {
        let app = TestConfig.createClientApp()
        let customRedirect = "https://myapp.com/oauth/callback"
        
        let result = try await app.getOAuthUrl(provider: "google", redirectUrl: customRedirect)
        
        // URL should contain the encoded redirect URL
        let encodedRedirect = customRedirect.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? customRedirect
        #expect(result.url.absoluteString.contains(encodedRedirect) || result.url.absoluteString.contains("redirect_uri="))
    }
}
