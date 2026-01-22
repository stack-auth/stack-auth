# StackClientApp

The main client-side SDK class.


## Constructor

StackClientApp(options)

Required:
  projectId: string - from Stack Auth dashboard
  publishableClientKey: string - from Stack Auth dashboard

Optional:
  baseUrl: string | { browser, server } 
    Default: "https://api.stack-auth.com"
    Can specify different URLs for browser vs server environments.
    
  tokenStore: "cookie" | "memory" | { accessToken, refreshToken } | null
    Default: "cookie" (JS) or "memory" (other SDKs)
    Where to store authentication tokens.
    "cookie" is JS-only due to complexity. See _utilities.spec.md for details.
      
  oauthScopesOnSignIn: object
    Additional OAuth scopes to request during sign-in for each provider.
    Example: { google: ["https://www.googleapis.com/auth/calendar"] }
    
  extraRequestHeaders: object
    Additional headers to include in every API request.
    
  redirectMethod: "nextjs" | "browser" | "none"
    How to perform redirects.
    "nextjs": Use Next.js redirect() function [JS-ONLY]
    "browser": Use window.location for client-side redirects
    "none": Don't redirect, return control to caller
    
  noAutomaticPrefetch: bool
    Default: false
    If true, skip prefetching project info on construction.

On construct: prefetch project info (GET /projects/current) unless noAutomaticPrefetch=true.


## signInWithOAuth(provider, options?)  [BROWSER-LIKE]

Starts an OAuth authentication flow with the specified provider.
Use an OAuth library (e.g., oauth4webapi) to handle PKCE and state management.

Arguments:
  provider: string - OAuth provider ID (e.g., "google", "github", "microsoft")
  
  options.presentationContextProvider: platform-specific [NATIVE-ONLY]
    - iOS/macOS: ASWebAuthenticationPresentationContextProviding
    - Android: Activity context for Custom Tabs

Returns: 
  - Browser: never (opens browser and redirects)
  - Native apps: void (async, completes when user finishes OAuth flow)

Note: Additional provider scopes are configured via oauthScopesOnSignIn constructor option.

Implementation:
1. Construct full redirect URLs using a fixed callback scheme:
   - Native apps: "stack-auth://success" and "stack-auth://error"
   - Browser: Use window.location to construct full URLs

2. Call getOAuthUrl() with the constructed URLs to get:
   - Authorization URL
   - State parameter
   - PKCE code verifier
   - Redirect URL

3. Store code verifier for later retrieval, keyed by state
   - Browser: cookie "stack-oauth-outer-{state}" (maxAge: 1 hour)
   - Mobile/other: in-memory (passed directly to callback handler)

4. Open the authorization URL:
   - Browser: window.location.assign(authorization_url)
   - iOS/macOS: ASWebAuthenticationSession with callbackURLScheme: "stack-auth"
   - Android: Custom Tabs with callback URL registered as deep link
   - Desktop: Open system browser with registered URL scheme for callback

5. Handle callback:
   - Browser: Never returns; user lands on callback page which calls callOAuthCallback()
   - Native apps: ASWebAuthenticationSession/Custom Tabs returns callback URL directly;
     call callOAuthCallback(url, codeVerifier, redirectUrl) to exchange code for tokens

Native App Implementation (iOS/macOS example):
```
let callbackScheme = "stack-auth"
let oauth = try await getOAuthUrl(
    provider: provider,
    redirectUrl: callbackScheme + "://success",
    errorRedirectUrl: callbackScheme + "://error"
)

let session = ASWebAuthenticationSession(
    url: oauth.url,
    callbackURLScheme: callbackScheme
) { callbackUrl, error in
    if let callbackUrl = callbackUrl {
        try await callOAuthCallback(url: callbackUrl, codeVerifier: oauth.codeVerifier, redirectUrl: oauth.redirectUrl)
    }
}
session.prefersEphemeralWebBrowserSession = false
session.start()
```

The flow continues when the user is redirected back to the callback URL.
Call callOAuthCallback() on the callback page/handler to complete the flow.

Error handling:
  - User cancellation: StackAuthError(code: "oauth_cancelled", message: "User cancelled OAuth")
  - Other errors: OAuthError(code: "oauth_error", message: <platform error description>)


## getOAuthUrl(provider, redirectUrl, errorRedirectUrl, options?)

Returns the OAuth authorization URL without performing the redirect.
Useful for non-browser environments or custom OAuth handling.

Arguments:
  provider: string - OAuth provider ID (e.g., "google", "github", "microsoft")
  redirectUrl: string - Full URL where the user will be redirected after OAuth (must contain "://")
  errorRedirectUrl: string - Full URL where the user will be redirected on error (must contain "://")
  options.state: string? - custom state parameter (default: auto-generated)
  options.codeVerifier: string? - custom PKCE verifier (default: auto-generated)

Returns: { url: string, state: string, codeVerifier: string, redirectUrl: string }
  url: The full authorization URL to open in a browser
  state: The state parameter (for CSRF verification)
  codeVerifier: The PKCE code verifier (store for token exchange)
  redirectUrl: The redirect URL (same as input, needed for token exchange - must match exactly)

Implementation:
1. Validate that redirectUrl and errorRedirectUrl are full URLs (contain "://")
   - If not, throw error with code "invalid_redirect_url" or "invalid_error_redirect_url"
2. Generate or use provided state and codeVerifier
3. Compute code challenge: base64url(sha256(codeVerifier))
4. Build authorization URL (same as signInWithOAuth step 5)
5. Return { url, state, codeVerifier, redirectUrl } without redirecting

The caller is responsible for:
- Constructing full URLs before calling (e.g., "stackauth-myapp://oauth-callback")
- Opening the URL in a browser/webview
- Storing the state, codeVerifier, and redirectUrl
- Calling callOAuthCallback() with the callback URL and these values

Errors:
  StackAuthError(invalid_redirect_url)
    message: "redirectUrl must be a full URL (e.g., 'stackauth-myapp://oauth-callback')"
    
  StackAuthError(invalid_error_redirect_url)
    message: "errorRedirectUrl must be a full URL (e.g., 'stackauth-myapp://error')"


## signInWithCredential(options)

Arguments:
  options.email: string
  options.password: string
  options.noRedirect: bool? - if true, don't redirect after success

Returns: void

Request:
  POST /api/v1/auth/password/sign-in
  Body: { email: string, password: string }

Response on success:
  { access_token: string, refresh_token: string }

Implementation:
1. Send request
2. On MFA required: redirect to MFA page (stores attempt_code in sessionStorage)
3. Store tokens { access_token, refresh_token }
4. Redirect to afterSignIn URL (unless noRedirect=true)

Errors:
  EmailPasswordMismatch
    code: "email_password_mismatch"
    message: "The email and password combination is incorrect."
    
  InvalidTotpCode
    code: "invalid_totp_code"
    message: "The MFA code is incorrect."


## signUpWithCredential(options)

Arguments:
  options.email: string
  options.password: string
  options.verificationCallbackUrl: string? - URL for email verification link
  options.noVerificationCallback: bool? - if true, skip email verification
  options.noRedirect: bool?

Returns: void

Request:
  POST /api/v1/auth/password/sign-up
  Body: { 
    email: string, 
    password: string, 
    verification_callback_url: string? 
  }

Response on success:
  { access_token: string, refresh_token: string }

Implementation:
1. If noVerificationCallback and verificationCallbackUrl both set: throw error
2. Build verification URL (unless noVerificationCallback=true)
3. Send request
4. If redirect URL not whitelisted error AND we didn't opt out of verification:
   - Log warning, retry without verification URL
5. Store tokens { access_token, refresh_token }
6. Redirect to afterSignUp URL (unless noRedirect=true)

Errors:
  UserWithEmailAlreadyExists
    code: "user_email_already_exists"
    message: "A user with this email address already exists."
    
  PasswordRequirementsNotMet
    code: "password_requirements_not_met"
    message: "The password does not meet the project's requirements."


## signOut(options?)

Arguments:
  options.redirectUrl: string? - where to redirect after sign out
  options.tokenStore: TokenStoreInit? - override token storage for this call

Returns: void

Request:
  DELETE /api/v1/auth/sessions/current [authenticated]
  Body: {}

Implementation:
1. Send request (ignore errors - session may already be invalid)
2. Clear stored tokens (mark session invalid)
3. Redirect to redirectUrl or afterSignOut URL

Does not error (errors are ignored).


## getUser(options?)

Arguments:
  options.or: "redirect" | "throw" | "return-null" | "anonymous"
    Default: "return-null"
  options.includeRestricted: bool?
    Default: false
    Whether to return users who haven't completed onboarding
  options.tokenStore: TokenStoreInit? - override token storage for this call

Returns: CurrentUser | null

IMPORTANT: { or: 'anonymous' } and { includeRestricted: false } are mutually exclusive.
Anonymous users are always restricted, so this combination doesn't make sense.
Throw an error if both are specified.

Request (to fetch user):
  GET /api/v1/users/me [authenticated]

Response on success:
  CurrentUserCrud object (see types/users/current-user.spec.md for full schema)

Request (to create anonymous user):
  POST /api/v1/auth/anonymous/sign-up
  Body: {}

Response:
  { access_token: string, refresh_token: string }

Implementation:
1. Get tokens from storage
2. Determine flags:
   - includeAnonymous = (or == "anonymous")
   - includeRestricted = (includeRestricted == true) OR includeAnonymous
3. If no tokens:
   - "redirect": redirect to signIn URL, never returns
   - "throw": throw UserNotSignedIn error
   - "anonymous": create anonymous user (POST above), store tokens, continue
   - "return-null": return null
4. GET /api/v1/users/me [authenticated]
5. On 401: token refresh & retry. If still 401: handle as step 3
6. On 200: construct CurrentUser object
7. Filter based on user state:
   - If user.isAnonymous and not includeAnonymous: handle as step 3
   - If user.isRestricted and not includeRestricted:
     - "redirect": redirect to onboarding URL (not sign-in!)
     - otherwise: handle as step 3

Errors (only when or="throw"):
  UserNotSignedIn
    code: "user_not_signed_in"
    message: "User is not signed in but getUser was called with { or: 'throw' }."


## getProject()

Returns: Project

Request:
  GET /api/v1/projects/current

Response:
  {
    id: string,
    display_name: string,
    config: {
      sign_up_enabled: bool,
      credential_enabled: bool,
      magic_link_enabled: bool,
      passkey_enabled: bool,
      oauth_providers: [{ id: string }],
      client_team_creation_enabled: bool,
      client_user_deletion_enabled: bool,
      allow_user_api_keys: bool,
      allow_team_api_keys: bool
    }
  }

Construct Project object (types/projects/project.spec.md).

Does not error.


## getPartialUser(options)

Get minimal user info without a full API call.
Useful for quickly checking auth state.

Arguments:
  options.from: "token" | "convex"
    - "token": Extract user info from the stored access token (JWT claims)
    - "convex": Extract user info from Convex auth context [JS-ONLY]
  
  For "convex" [JS-ONLY]:
    options.ctx: ConvexQueryContext - the Convex query context
  
  options.tokenStore: TokenStoreInit? - override token storage for this call

Returns: TokenPartialUser | null

TokenPartialUser:
  id: string
  displayName: string | null
  primaryEmail: string | null
  primaryEmailVerified: bool
  isAnonymous: bool
  isRestricted: bool
  restrictedReason: { type: "anonymous" | "email_not_verified" } | null

Implementation for "token":
1. Get access token from storage
2. If no token: return null
3. Decode JWT payload (base64url decode middle segment)
4. Extract fields: sub (id), name, email, email_verified, is_anonymous, is_restricted, restricted_reason

Implementation for "convex" [JS-ONLY]:
1. Call ctx.auth.getUserIdentity()
2. If null: return null
3. Map: subject→id, name→displayName, email, email_verified, is_anonymous, is_restricted, restricted_reason

Does not error.


## cancelSubscription(options)

Cancel an active subscription.

Arguments:
  options.productId: string - the subscription product to cancel
  options.teamId: string? - if canceling a team subscription
  options.tokenStore: TokenStoreInit? - override token storage for this call

Returns: void

Request:
  POST /api/v1/subscriptions/cancel [authenticated]
  Body: { product_id: string, team_id?: string }

Does not error.


## getAccessToken(options?)

Arguments:
  options.tokenStore: TokenStoreInit? - override token storage for this call

Returns: string | null

Get access token from storage.
If expired or expiring soon: perform token refresh (see _utilities.spec.md).
Return token string, or null if not authenticated.

Does not error.


## getRefreshToken(options?)

Arguments:
  options.tokenStore: TokenStoreInit? - override token storage for this call

Returns: string | null

Get refresh token from storage.
Return token string, or null if not authenticated.

Does not error.


## getAuthHeaders(options?)

Arguments:
  options.tokenStore: TokenStoreInit? - override token storage for this call

Returns: { "x-stack-auth": string }

Get current tokens and JSON-encode as header value:
  { "accessToken": "<token>", "refreshToken": "<token>" }

For cross-origin authenticated requests where cookies can't be sent.

Does not error.


## sendForgotPasswordEmail(email, callbackUrl)

Arguments:
  email: string - The user's email address
  callbackUrl: string - URL where the user will be redirected to reset their password

Returns: void

Request:
  POST /api/v1/auth/password/send-reset-code
  Body: { email: string, callback_url: string }

Errors:
  UserNotFound
    code: "user_not_found"
    message: "No user with this email address was found."


## verifyPasswordResetCode(code)

Verifies a password reset code is valid before showing the reset form.
Call this before showing the password input to avoid user frustration.

Arguments:
  code: string - from password reset email URL

Returns: void

Request:
  POST /api/v1/auth/password/reset/check-code
  Body: { code: string }

Errors:
  VerificationCodeError
    code: "verification_code_error"
    message: "The verification code is invalid or expired."


## resetPassword(options)

Arguments:
  options.code: string - from password reset email
  options.password: string - new password

Returns: void

Request:
  POST /api/v1/auth/password/reset
  Body: { code: string, password: string }

Errors:
  VerificationCodeError
    code: "verification_code_error"
    message: "The verification code is invalid or expired."
    
  PasswordRequirementsNotMet
    code: "password_requirements_not_met"
    message: "The password does not meet the project's requirements."


## sendMagicLinkEmail(email, callbackUrl)

Arguments:
  email: string - The user's email address
  callbackUrl: string - URL where the user will be redirected after clicking the magic link

Returns: { nonce: string }

Request:
  POST /api/v1/auth/otp/send-sign-in-code
  Body: { email: string, callback_url: string }

Response:
  { nonce: string }

Errors:
  RedirectUrlNotWhitelisted
    code: "redirect_url_not_whitelisted"
    message: "The callback URL is not in the project's trusted domains list."


## signInWithMagicLink(code, options?)

Arguments:
  code: string - from magic link URL
  options.noRedirect: bool?

Returns: void

Request:
  POST /api/v1/auth/otp/sign-in
  Body: { code: string }

Response on success:
  { access_token: string, refresh_token: string, is_new_user: bool }

Implementation:
1. Send request
2. On MFA required: redirect to MFA page (stores attempt_code in sessionStorage)
3. Store tokens { access_token, refresh_token }
4. Redirect to afterSignIn or afterSignUp based on is_new_user (unless noRedirect)

Errors:
  VerificationCodeError
    code: "verification_code_error"
    message: "The verification code is invalid or expired."
  
  InvalidTotpCode
    code: "invalid_totp_code"
    message: "The MFA code is incorrect."


## signInWithMfa(totp, code, options?)

Completes sign-in when MFA is required.
Called after receiving MultiFactorAuthenticationRequired error from another sign-in method.

Arguments:
  totp: string - 6-digit TOTP code from authenticator app
  code: string - the attempt code from MFA error or sessionStorage
  options.noRedirect: bool?

Returns: void

Request:
  POST /api/v1/auth/mfa/sign-in
  Body: { type: "totp", totp: string, code: string }

Response on success:
  { access_token: string, refresh_token: string, is_new_user: bool }

Implementation:
1. Send request
2. Store tokens { access_token, refresh_token }
3. Redirect to afterSignIn or afterSignUp based on is_new_user (unless noRedirect)

Errors:
  VerificationCodeError
    code: "verification_code_error"
    message: "The verification code is invalid or expired."
    
  InvalidTotpCode
    code: "invalid_totp_code"
    message: "The MFA code is incorrect."


## signInWithPasskey()  [BROWSER-LIKE]

Returns: void

Requires WebAuthn support:
- Browser: native WebAuthn API
- iOS: ASAuthorizationPlatformPublicKeyCredentialProvider
- Android: FIDO2 API via Google Play Services

Implementation:
1. Initiate authentication:
   POST /api/v1/auth/passkey/initiate-passkey-authentication
   Body: {}
   Response: { options_json: PublicKeyCredentialRequestOptions, code: string }

2. Replace options_json.rpId with actual hostname (window.location.hostname)
   The server returns a sentinel value that must be replaced.

3. Call platform WebAuthn/FIDO2 API:
   - Browser: use WebAuthn library (e.g., @simplewebauthn/browser)
   - iOS/Android: use platform passkey APIs
   authentication_response = startAuthentication(options_json)
   
4. Complete authentication:
   POST /api/v1/auth/passkey/sign-in
   Body: { authentication_response: <WebAuthn response>, code: string }
   Response: { access_token: string, refresh_token: string }

5. On MFA required: redirect to MFA page
6. Store tokens, redirect to afterSignIn

Errors:
  PasskeyAuthenticationFailed
    code: "passkey_authentication_failed"
    message: "Passkey authentication failed. Please try again."
    
  PasskeyWebAuthnError
    code: "passkey_webauthn_error"
    message: "WebAuthn error: {errorName}."
    (errorName from WebAuthn/FIDO2 API error)
    
  InvalidTotpCode
    code: "invalid_totp_code"
    message: "The MFA code is incorrect."


## verifyEmail(code, options?)

Arguments:
  code: string - from email verification link
  options.tokenStore: TokenStoreInit? - override token storage for this call

Returns: void

Request:
  POST /api/v1/contact-channels/verify
  Body: { code: string }

Implementation:
1. Send request
2. Refresh user cache and contact channels cache

Errors:
  VerificationCodeError
    code: "verification_code_error"
    message: "The verification code is invalid or expired."


## acceptTeamInvitation(code, options?)

Arguments:
  code: string - from team invitation email
  options.tokenStore: TokenStoreInit? - override token storage for this call

Returns: void

Request:
  POST /api/v1/team-invitations/accept [authenticated]
  Body: { code: string }

Errors:
  VerificationCodeError
    code: "verification_code_error"
    message: "The verification code is invalid or expired."


## verifyTeamInvitationCode(code, options?)

Verifies a team invitation code is valid before accepting.

Arguments:
  code: string - from team invitation email
  options.tokenStore: TokenStoreInit? - override token storage for this call

Returns: void

Request:
  POST /api/v1/team-invitations/accept/check-code [authenticated]
  Body: { code: string }

Errors:
  VerificationCodeError
    code: "verification_code_error"
    message: "The verification code is invalid or expired."


## getTeamInvitationDetails(code, options?)

Arguments:
  code: string
  options.tokenStore: TokenStoreInit? - override token storage for this call

Returns: { teamDisplayName: string }

Request:
  POST /api/v1/team-invitations/accept/details [authenticated]
  Body: { code: string }

Response:
  { team_display_name: string }

Errors:
  VerificationCodeError
    code: "verification_code_error"
    message: "The verification code is invalid or expired."


## callOAuthCallback()  [BROWSER-LIKE]

Completes the OAuth flow after redirect from OAuth provider.
Call this on the OAuth callback page/handler.

Returns: bool
  Returns true if OAuth callback was handled and user signed in.
  Returns false if no OAuth callback params present (not an OAuth callback).

Implementation:
1. Get the callback URL from window.location.href

2. Check URL for OAuth callback params: "code" and "state"
   If missing: return false (not an OAuth callback)

3. Retrieve code verifier and redirect URL using state key from cookie "stack-oauth-outer-{state}"
   If not found: return false (callback not for us, or already consumed)
   Delete cookie after retrieving.

4. Remove OAuth params from URL (history.replaceState to hide code)

5. Exchange authorization code for tokens using OAuth2 authorization_code grant:
   Use OAuth library (e.g., oauth4webapi) for proper handling.
   
   Token endpoint: /api/v1/auth/oauth/token
   Grant type: authorization_code
   Parameters:
     - code: <authorization code from URL>
     - redirect_url: <stored redirect URL from cookie>
     - code_verifier: <PKCE verifier from cookie>
     - client_id: <projectId>
     - client_secret: <publishableClientKey>

   Response on success:
     { 
       access_token: string, 
       refresh_token: string,
       is_new_user: bool,
       after_callback_redirect_url?: string
     }

6. On MFA required: redirect to MFA page, return false
7. Store tokens { access_token, refresh_token }
8. Redirect to:
   - after_callback_redirect_url (if present in response), or
   - afterSignUp URL (if is_new_user), or
   - afterSignIn URL
9. Return true

Does not return errors - throws on OAuth errors.


## callOAuthCallback(url, codeVerifier, redirectUrl)  [NON-BROWSER]

Non-browser variant for native apps (iOS, macOS, Android).
Called after receiving the callback URL from ASWebAuthenticationSession or similar.

Arguments:
  url: URL - the callback URL received from the OAuth provider
  codeVerifier: string - the PKCE code verifier from getOAuthUrl()
  redirectUrl: string - the redirect URL from getOAuthUrl() (must match exactly)

Returns: void

Implementation:
1. Parse the callback URL to extract "code" and "error" query parameters

2. If "error" present: throw OAuthError with error code and description from URL

3. If "code" missing: throw OAuthError("missing_code", "No authorization code in callback URL")

4. Exchange authorization code for tokens:
   POST /api/v1/auth/oauth/token
   Content-Type: application/x-www-form-urlencoded
   Headers:
     - x-stack-project-id: <projectId>
   Body:
     - grant_type=authorization_code
     - code=<authorization code from URL>
     - redirect_uri=<redirectUrl argument - must match getOAuthUrl exactly>
     - code_verifier=<codeVerifier argument>
     - client_id=<projectId>
     - client_secret=<publishableClientKey>

   Response on success:
     { access_token: string, refresh_token?: string }

5. Store tokens { access_token, refresh_token }
   Note: refresh_token may be optional depending on server configuration

IMPORTANT: The redirect_url must exactly match the one used in getOAuthUrl().
This is why getOAuthUrl() returns redirectUrl - store it and pass it here.

Errors:
  OAuthError(<error from URL>)
    message: <error_description from URL> or "OAuth error"
    When: OAuth provider returned an error in the callback URL
    
  OAuthError(missing_code)
    message: "No authorization code in callback URL"
    When: No "code" query parameter in callback URL
    
  OAuthError(invalid_response)
    message: "Invalid HTTP response"
    When: Token exchange response is not a valid HTTP response
    
  OAuthError(<error from response>)
    message: <error_description from response> or "Token exchange failed"
    When: Token exchange endpoint returns an error
    
  OAuthError(token_exchange_failed)
    message: "HTTP <status_code>"
    When: Token exchange returns non-200 status without error details
    
  OAuthError(parse_error)
    message: "Failed to parse token response"
    When: Token exchange response is not valid JSON or missing access_token


## promptCliLogin(options)  [CLI-ONLY]

Initiates a CLI authentication flow. Used for authenticating CLI tools.
Opens a browser for the user to sign in, then polls for completion.

Only available in languages/platforms with an interactive terminal.

Arguments:
  options.appUrl: string - base URL of your app (for the login page)
  options.expiresInMillis: number? - how long the login attempt is valid
  options.maxAttempts: number? - max polling attempts (default: Infinity)
  options.waitTimeMillis: number? - time between poll attempts (default: 2000ms)
  options.promptLink: function(url: string)? - callback to display login URL to user

Returns: string - the refresh token for the authenticated session

Implementation:
1. Initiate CLI auth:
   POST /api/v1/auth/cli
   Body: { expires_in_millis?: number }
   Response: { polling_code: string, login_code: string }

2. Build login URL: {appUrl}/handler/cli?code={login_code}
3. Call promptLink(url) if provided, or open browser to URL

4. Poll for completion:
   POST /api/v1/auth/cli/poll
   Body: { polling_code: string }
   Response on pending: { status: "pending" }
   Response on success: { status: "success", refresh_token: string }
   
   Poll every waitTimeMillis until success, error, or maxAttempts reached.

5. Return refresh_token

Errors:
  CliAuthError
    code: "cli_auth_error"
    message: "CLI authentication failed."
    
  CliAuthExpiredError
    code: "cli_auth_expired"
    message: "CLI authentication attempt expired. Please try again."
    
  CliAuthUsedError
    code: "cli_auth_used"
    message: "This CLI authentication code has already been used."


## getItem(options)

Get a purchased item for a customer.

Arguments:
  Customer identification (one of):
    options.userId: string
    options.teamId: string
    options.customCustomerId: string
  options.itemId: string
  options.tokenStore: TokenStoreInit? - override token storage for this call

Returns: Item

Request:
  GET /api/v1/customers/{customer_type}/{customer_id}/items/{itemId} [authenticated]
  
  customer_type is "user", "team", or "custom"
  customer_id is the corresponding ID

Response:
  { id: string, quantity: number }

Does not error.


## listProducts(options)

List products available to a customer.

Arguments:
  Customer identification (one of):
    options.userId: string
    options.teamId: string
    options.customCustomerId: string
  options.cursor: string? - pagination cursor
  options.limit: number? - max results
  options.tokenStore: TokenStoreInit? - override token storage for this call

Returns: CustomerProductsList

Request:
  GET /api/v1/customers/{customer_type}/{customer_id}/products [authenticated]
  Query params: cursor?, limit?

Response:
  { 
    items: [{ id, name, quantity, ... }],
    pagination: { next_cursor?: string }
  }

Does not error.


## getConvexClientAuth(options)  [JS-ONLY]

Get auth callback for Convex client integration.

options.tokenStore: TokenStoreInit? - override token storage

Returns: function({ forceRefreshToken: bool }) => Promise<string | null>

The returned function is passed to Convex's useConvexAuth() hook.
It returns the access token (refreshed if needed) or null if not authenticated.

Does not error.


## getConvexHttpClientAuth(options)  [JS-ONLY]

Get auth token for Convex HTTP client.

options.tokenStore: TokenStoreInit

Returns: string - the access token for Convex HTTP requests

Does not error.


## Redirect Methods  [BROWSER-ONLY]

These methods are only available in browser environments (JavaScript SDK).
Non-browser SDKs (Swift, Python, etc.) should NOT expose these methods.

All redirect methods take optional options:

Options:
  replace: bool? - if true, replace current history entry instead of pushing
  noRedirectBack: bool? - if true, don't set after_auth_return_to param

Methods:
  redirectToSignIn()         - redirect to signIn URL
  redirectToSignUp()         - redirect to signUp URL
  redirectToSignOut()        - redirect to signOut URL
  redirectToAfterSignIn()    - redirect to afterSignIn URL
  redirectToAfterSignUp()    - redirect to afterSignUp URL
  redirectToAfterSignOut()   - redirect to afterSignOut URL
  redirectToHome()           - redirect to home URL
  redirectToAccountSettings() - redirect to accountSettings URL
  redirectToForgotPassword() - redirect to forgotPassword URL
  redirectToPasswordReset()  - redirect to passwordReset URL
  redirectToEmailVerification() - redirect to emailVerification URL
  redirectToOnboarding()     - redirect to onboarding URL
  redirectToError()          - redirect to error URL
  redirectToMfa()            - redirect to mfa URL
  redirectToTeamInvitation() - redirect to teamInvitation URL
  redirectToOAuthCallback()  - redirect to oauthCallback URL
  redirectToMagicLinkCallback() - redirect to magicLinkCallback URL

Implementation:

1. Get the target URL from the urls config
2. For signIn/signUp/onboarding (unless noRedirectBack=true):
   - Check if current URL has after_auth_return_to query param
   - If yes: preserve it in the target URL
   - If no: set after_auth_return_to to current page URL
3. For afterSignIn/afterSignUp:
   - Check current URL for after_auth_return_to query param
   - If present: redirect to that URL instead of the default
4. Perform redirect based on redirectMethod config:
   - "browser": window.location.assign() or .replace()
   - "nextjs": Next.js redirect() function [JS-ONLY]
   - "none": don't redirect (for headless/API use)
   - Custom navigate function: call it with the URL

Do not error.
