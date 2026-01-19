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
    
  urls: object
    Override handler URLs. Defaults under "/handler":
      signIn: "/handler/sign-in"
      signUp: "/handler/sign-up"
      afterSignIn: "/"
      afterSignUp: "/"
      ... see apps/backend for full list
      
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
  options.returnTo: string? - URL to return to after OAuth completes (default: urls.oauthCallback)

Returns: never (opens browser/webview and redirects)

Note: Additional provider scopes are configured via oauthScopesOnSignIn constructor option.

Implementation:
1. Generate PKCE code verifier (43+ character random string)
2. Compute code challenge: base64url(sha256(code_verifier))
3. Generate random state string for CSRF protection
4. Store code verifier for later retrieval, keyed by state
   - Browser: cookie "stack-oauth-outer-{state}" (maxAge: 1 hour)
   - Mobile/other: secure storage appropriate to the platform

5. Build authorization URL:
   GET /api/v1/auth/oauth/authorize/{provider}
   Query params:
     client_id: <projectId>
     client_secret: <publishableClientKey>
     redirect_uri: <urls.oauthCallback> (with code/state params removed if present)
     scope: "legacy"
     state: <generated state>
     grant_type: "authorization_code"
     code_challenge: <computed challenge>
     code_challenge_method: "S256"
     response_type: "code"
     type: "authenticate"
     error_redirect_url: <urls.error>
     token: <access_token if user already logged in> (optional)
     provider_scope: <options.providerScope> (if provided)
   
   Response: HTTP redirect (302) to OAuth provider's authorization page

6. Open the authorization URL:
   - Browser: window.location.assign(authorization_url)
   - Mobile: Open in-app browser/WebView (e.g., ASWebAuthenticationSession on iOS,
     Custom Tabs on Android) with the callback URL registered as a deep link
   - Desktop: Open system browser with registered URL scheme for callback

7. Never returns (control transfers to browser/webview)

The flow continues when the user is redirected back to urls.oauthCallback.
Call callOAuthCallback() on the callback page/handler to complete the flow.

Does not error (redirects before any error can occur).


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
      oauth_providers: [{ id: string, type: string }],
      client_team_creation_enabled: bool,
      client_user_deletion_enabled: bool,
      domains: [{ domain: string, handler_path: string }]
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

Returns: void

Request:
  POST /api/v1/subscriptions/cancel [authenticated]
  Body: { product_id: string, team_id?: string }

Does not error.


## getAccessToken()

Returns: string | null

Get access token from storage.
If expired or expiring soon: perform token refresh (see _utilities.spec.md).
Return token string, or null if not authenticated.

Does not error.


## getRefreshToken()

Returns: string | null

Get refresh token from storage.
Return token string, or null if not authenticated.

Does not error.


## getAuthHeaders()

Returns: { "x-stack-auth": string }

Get current tokens and JSON-encode as header value:
  { "accessToken": "<token>", "refreshToken": "<token>" }

For cross-origin authenticated requests where cookies can't be sent.

Does not error.


## sendForgotPasswordEmail(email, options?)

Arguments:
  email: string
  options.callbackUrl: string? - URL for password reset link (default: urls.passwordReset)

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


## sendMagicLinkEmail(email, options?)

Arguments:
  email: string
  options.callbackUrl: string? - (default: urls.magicLinkCallback)

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


## verifyEmail(code)

Arguments:
  code: string - from email verification link

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


## acceptTeamInvitation(code)

Arguments:
  code: string - from team invitation email

Returns: void

Request:
  POST /api/v1/team-invitations/accept [authenticated]
  Body: { code: string }

Errors:
  VerificationCodeError
    code: "verification_code_error"
    message: "The verification code is invalid or expired."


## verifyTeamInvitationCode(code)

Verifies a team invitation code is valid before accepting.

Arguments:
  code: string - from team invitation email

Returns: void

Request:
  POST /api/v1/team-invitations/accept/check-code [authenticated]
  Body: { code: string }

Errors:
  VerificationCodeError
    code: "verification_code_error"
    message: "The verification code is invalid or expired."


## getTeamInvitationDetails(code)

Arguments:
  code: string

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
Call this on the OAuth callback page/handler (urls.oauthCallback).

Returns: bool
  Returns true if OAuth callback was handled and user signed in.
  Returns false if no OAuth callback params present (not an OAuth callback).

Implementation:
1. Get the callback URL from window.location.href

2. Check URL for OAuth callback params: "code" and "state"
   If missing: return false (not an OAuth callback)

3. Retrieve code verifier using state key from cookie "stack-oauth-outer-{state}"
   If not found: return false (callback not for us, or already consumed)
   Delete cookie after retrieving.

4. Remove OAuth params from URL (history.replaceState to hide code)

5. Exchange authorization code for tokens using OAuth2 authorization_code grant:
   Use OAuth library (e.g., oauth4webapi) for proper handling.
   
   Token endpoint: /api/v1/auth/oauth/token
   Grant type: authorization_code
   Parameters:
     - code: <authorization code from URL>
     - redirect_uri: <urls.oauthCallback>
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
   - afterSignUp (if is_new_user), or
   - afterSignIn
9. Return true

Does not return errors - throws on OAuth errors.


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


## Redirect Methods

All redirect methods take optional { replace?: bool, noRedirectBack?: bool }.

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

Special behavior for signIn/signUp/onboarding:
- If URL has after_auth_return_to query param, preserve it
- Otherwise, set after_auth_return_to to current URL (for redirect after auth)

Special behavior for afterSignIn/afterSignUp:
- Check URL for after_auth_return_to query param and redirect there instead

All require browser or framework-specific redirect capability.
Do not error.
