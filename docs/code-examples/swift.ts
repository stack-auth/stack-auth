import { CodeExample } from '../lib/code-examples';

export const swiftExamples = {
  'swift': {
    'installation': [
      {
        language: 'Swift',
        framework: 'Swift',
        variant: 'package',
        code: `dependencies: [
    .package(url: "https://github.com/stack-auth/swift-sdk-prerelease", from: "0.1.0")
]`,
        highlightLanguage: 'swift',
        filename: 'Package.swift'
      }
    ] as CodeExample[],

    'init-sdk': [
      {
        language: 'Swift',
        framework: 'Swift',
        code: `import StackAuth

let stack = StackClientApp(
    projectId: "your-project-id",
    publishableClientKey: "pck_your-publishable-key"
)`,
        highlightLanguage: 'swift',
        filename: 'App.swift'
      }
    ] as CodeExample[],

    'sign-up-sign-in': [
      {
        language: 'Swift',
        framework: 'Swift',
        code: `// Sign up with email/password
try await stack.signUpWithCredential(
    email: "user@example.com", 
    password: "securepassword123"
)

// Sign in with email/password
try await stack.signInWithCredential(
    email: "user@example.com", 
    password: "securepassword123"
)

// OAuth sign-in (opens system browser)
try await stack.signInWithOAuth(provider: "google")`,
        highlightLanguage: 'swift',
        filename: 'AuthView.swift'
      }
    ] as CodeExample[],

    'get-user': [
      {
        language: 'Swift',
        framework: 'Swift',
        code: `if let user = try await stack.getUser() {
    print("Signed in as \\(user.displayName ?? "Unknown")")
    print("Email: \\(user.primaryEmail ?? "No email")")
}`,
        highlightLanguage: 'swift',
        filename: 'UserView.swift'
      }
    ] as CodeExample[],

    'sign-out': [
      {
        language: 'Swift',
        framework: 'Swift',
        code: `try await stack.signOut()`,
        highlightLanguage: 'swift',
        filename: 'AuthView.swift'
      }
    ] as CodeExample[],

    'token-storage': [
      {
        language: 'Swift',
        framework: 'Swift',
        code: `// Default: Keychain (secure, persists across app launches)
let stack = StackClientApp(
    projectId: "...",
    publishableClientKey: "..."
)

// Memory storage (for testing or ephemeral sessions)
let stack = StackClientApp(
    projectId: "...",
    publishableClientKey: "...",
    tokenStore: .memory
)

// Explicit tokens (for server-side scenarios)
let stack = StackClientApp(
    projectId: "...",
    publishableClientKey: "...",
    tokenStore: .explicit(accessToken: "...", refreshToken: "...")
)`,
        highlightLanguage: 'swift',
        filename: 'App.swift'
      }
    ] as CodeExample[],

    'error-handling': [
      {
        language: 'Swift',
        framework: 'Swift',
        code: `do {
    try await stack.signInWithCredential(email: email, password: password)
} catch let error as StackAuthError {
    switch error.code {
    case "EMAIL_PASSWORD_MISMATCH":
        print("Invalid email or password")
    case "USER_NOT_FOUND":
        print("No account found with this email")
    default:
        print("Error: \\(error.message)")
    }
}`,
        highlightLanguage: 'swift',
        filename: 'AuthView.swift'
      }
    ] as CodeExample[],

    'oauth': [
      {
        language: 'Swift',
        framework: 'Swift',
        variant: 'simple',
        code: `// Opens system browser, handles callback automatically
// Uses the fixed callback scheme: stack-auth://
try await stack.signInWithOAuth(provider: "google")`,
        highlightLanguage: 'swift',
        filename: 'AuthView.swift'
      },
      {
        language: 'Swift',
        framework: 'Swift',
        variant: 'custom',
        code: `// Get OAuth URL for manual handling
// Must provide full URLs with scheme
let oauth = try await stack.getOAuthUrl(
    provider: "google",
    redirectUrl: "stack-auth://oauth-callback",
    errorRedirectUrl: "stack-auth://error"
)

// Open oauth.url in your own browser/webview
// Store oauth.state, oauth.codeVerifier, and oauth.redirectUrl

// When callback is received:
try await stack.callOAuthCallback(
    url: callbackUrl,
    codeVerifier: oauth.codeVerifier,
    redirectUrl: oauth.redirectUrl
)`,
        highlightLanguage: 'swift',
        filename: 'OAuthHandler.swift'
      }
    ] as CodeExample[],

    'server-side': [
      {
        language: 'Swift',
        framework: 'Swift',
        code: `let serverApp = StackServerApp(
    projectId: "your-project-id",
    secretServerKey: "ssk_your-secret-key"
)

// List all users
let users = try await serverApp.listUsers()

// Get a specific user
let user = try await serverApp.getUser(userId: "user-id")

// Create a user
let newUser = try await serverApp.createUser(
    primaryEmail: "new@example.com",
    password: "securepassword"
)`,
        highlightLanguage: 'swift',
        filename: 'Server.swift'
      }
    ] as CodeExample[],
  }
};
