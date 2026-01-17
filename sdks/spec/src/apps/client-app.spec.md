# StackClientApp

The main client-side SDK class. Safe for browser use.


## Constructor

StackClientApp(options)

Required:
  projectId: string - from Stack Auth dashboard
  publishableClientKey: string - from Stack Auth dashboard

Optional:
  baseUrl: string | { browser, server } 
    Default: "https://api.stack-auth.com"
    Can specify different URLs for browser vs server environments.
    
  tokenStore: "cookie" | "memory" | RequestLike
    Default: "cookie"
    Where to store authentication tokens.
    "cookie" requires browser environment.
    
  urls: object
    Override handler URLs. Defaults under "/handler":
      signIn: "/handler/sign-in"
      signUp: "/handler/sign-up"
      afterSignIn: "/"
      afterSignUp: "/"
      ... see apps/backend for full list

On construct: prefetch project info (GET /projects/current) unless noAutomaticPrefetch=true.


## signInWithOAuth(provider, options?)  [BROWSER-ONLY]

provider: string - e.g. "google", "github", "microsoft"
options.returnTo: string? - URL to redirect after auth completes

Implementation:
1. Generate 32-char random state string
2. Store state in sessionStorage with key "stack-oauth-{state}"
3. Redirect browser to: /auth/oauth/authorize/{provider}
   Query params: state, redirect_uri, after_callback_redirect_url
   Route: apps/backend/src/app/api/latest/auth/oauth/authorize/[provider]/route.ts

Does not return (redirects browser).
Does not error.


## signInWithCredential(options)

options.email: string
options.password: string
options.noRedirect: bool? - if true, don't redirect after success

POST /auth/password/sign-in { email, password }
Route: apps/backend/src/app/api/latest/auth/password/sign-in/route.ts

On 200: store tokens { access_token, refresh_token }
        redirect to afterSignIn URL (unless noRedirect=true)

Errors:
  EmailPasswordMismatch
    code: "email_password_mismatch"
    message: "The email and password combination is incorrect."
    
  InvalidTotpCode
    code: "invalid_totp_code"
    message: "The MFA code is incorrect. Please try again."


## signUpWithCredential(options)

options.email: string
options.password: string
options.verificationCallbackUrl: string? - URL for email verification link
options.noRedirect: bool?

POST /auth/password/sign-up { email, password, verification_callback_url }
Route: apps/backend/src/app/api/latest/auth/password/sign-up/route.ts

On 200: store tokens, redirect to afterSignUp (unless noRedirect=true)

Errors:
  UserWithEmailAlreadyExists
    code: "user_email_already_exists"
    message: "A user with this email address already exists."
    
  PasswordRequirementsNotMet
    code: "password_requirements_not_met"
    message: "The password does not meet the project's requirements."


## signOut(options?)

options.redirectUrl: string? - where to redirect after sign out

POST /auth/sessions/current/sign-out [authenticated]
  Ignore errors (session may already be invalid)
Clear stored tokens.
Redirect to redirectUrl or afterSignOut URL.

Does not error.


## getUser(options?)

options.or: "redirect" | "throw" | "return-null" | "anonymous"
  Default: "return-null"
options.includeRestricted: bool?
  Default: false
  Whether to return users who haven't completed onboarding (email verification, etc.)

Returns: CurrentUser | null

Implementation:
1. Get tokens from storage
2. If no tokens:
   - "redirect": redirect to signIn URL, never returns
   - "throw": throw UserNotSignedIn error
   - "anonymous": POST /auth/users (creates anonymous user), store tokens, continue
   - "return-null": return null
3. GET /users/me [authenticated]
   Route: apps/backend/src/app/api/latest/users/me/route.ts
4. On 401: [token-refresh], retry once. If still 401: handle as step 2
5. On 200: construct CurrentUser object (types/users/current-user.spec.md)
6. If user.isRestricted and not includeRestricted:
   - "redirect": redirect to onboarding URL
   - otherwise: handle as step 2

Errors (only when or="throw"):
  UserNotSignedIn
    code: "user_not_signed_in"
    message: "User is not signed in but getUser was called with { or: 'throw' }."


## getProject()

Returns: Project

GET /projects/current
Route: apps/backend/src/app/api/latest/projects/current/route.ts

Construct Project object (types/projects/project.spec.md).

Does not error.


## getAccessToken()

Returns: string | null

Get access token from storage.
If expired: [token-refresh].
Return token string, or null if not authenticated.

Does not error.


## getRefreshToken()

Returns: string | null

Get refresh token from storage.
Return token string, or null if not authenticated.

Does not error.


## getAuthHeaders()

Returns: { "x-stack-auth": string }

JSON-encode { accessToken, refreshToken } into header value.
For cross-origin authenticated requests.

Does not error.


## sendForgotPasswordEmail(email, options?)

email: string
options.callbackUrl: string? - URL for password reset link

POST /auth/password/forgot { email, callback_url }
Route: apps/backend/src/app/api/latest/auth/password/forgot/route.ts

Errors:
  UserNotFound
    code: "user_not_found"
    message: "No user with this email address was found."


## resetPassword(options)

options.code: string - from password reset email
options.password: string - new password

POST /auth/password/reset { code, password }
Route: apps/backend/src/app/api/latest/auth/password/reset/route.ts

Errors:
  VerificationCodeError (see _errors.spec.md)
  
  PasswordRequirementsNotMet
    code: "password_requirements_not_met"
    message: "The password does not meet the project's requirements."


## sendMagicLinkEmail(email, options?)

email: string
options.callbackUrl: string?

Returns: { nonce: string }

POST /auth/magic-link/send { email, callback_url }
Route: apps/backend/src/app/api/latest/auth/magic-link/send/route.ts

Errors:
  RedirectUrlNotWhitelisted
    code: "redirect_url_not_whitelisted"
    message: "The callback URL is not in the project's trusted domains list."


## signInWithMagicLink(code, options?)

code: string - from magic link URL
options.noRedirect: bool?

POST /auth/magic-link/sign-in { code }
Route: apps/backend/src/app/api/latest/auth/magic-link/sign-in/route.ts

On 200: store tokens
        redirect to afterSignIn or afterSignUp based on newUser flag (unless noRedirect)

Errors:
  VerificationCodeError (see _errors.spec.md)
  
  InvalidTotpCode
    code: "invalid_totp_code"
    message: "The MFA code is incorrect. Please try again."


## signInWithPasskey()  [BROWSER-ONLY]

Implementation:
1. POST /auth/passkey/authenticate/initiate {}
   Response: { options_json, code }
2. Replace options_json.rpId with window.location.hostname
3. Call WebAuthn API startAuthentication(options_json)
   Requires WebAuthn library (e.g., @simplewebauthn/browser)
4. POST /auth/passkey/authenticate { authentication_response, code }
5. On 200: store tokens, redirect to afterSignIn

Errors:
  PasskeyAuthenticationFailed
    code: "passkey_authentication_failed"
    message: "Passkey authentication failed. Please try again."
    
  PasskeyWebAuthnError
    code: "passkey_webauthn_error"
    message: "WebAuthn error: {errorName}."
    errorName comes from the WebAuthn API error.
    
  InvalidTotpCode
    code: "invalid_totp_code"
    message: "The MFA code is incorrect. Please try again."


## verifyEmail(code)

code: string - from email verification link

POST /auth/email-verification/verify { code }
Route: apps/backend/src/app/api/latest/auth/email-verification/verify/route.ts

Errors:
  VerificationCodeError (see _errors.spec.md)


## acceptTeamInvitation(code)

code: string - from team invitation email

POST /teams/invitations/accept { code } [authenticated]
Route: apps/backend/src/app/api/latest/teams/invitations/accept/route.ts

Errors:
  VerificationCodeError (see _errors.spec.md)


## getTeamInvitationDetails(code)

code: string

Returns: { teamDisplayName: string }

POST /teams/invitations/details { code }

Errors:
  VerificationCodeError (see _errors.spec.md)


## callOAuthCallback()  [BROWSER-ONLY]

Called on the OAuth callback page to complete the flow.

Returns: bool - true if successful, false if no callback to handle

Implementation:
1. Read state and code from URL query params
2. Validate state matches sessionStorage
3. POST /auth/oauth/callback { code, state }
4. On success: store tokens, redirect to afterSignIn/afterSignUp
5. Return true

Errors:
  InvalidTotpCode
    code: "invalid_totp_code"
    message: "The MFA code is incorrect. Please try again."


## Redirect Methods

All redirect methods take optional { replace?: bool, noRedirectBack?: bool }.

redirectToSignIn()      - redirect to signIn URL
redirectToSignUp()      - redirect to signUp URL
redirectToSignOut()     - redirect to signOut URL
redirectToAfterSignIn() - redirect to afterSignIn URL
redirectToAfterSignUp() - redirect to afterSignUp URL
redirectToAfterSignOut() - redirect to afterSignOut URL
redirectToHome()        - redirect to home URL
redirectToAccountSettings() - redirect to accountSettings URL
redirectToForgotPassword() - redirect to forgotPassword URL
redirectToPasswordReset() - redirect to passwordReset URL
redirectToEmailVerification() - redirect to emailVerification URL
redirectToOnboarding()  - redirect to onboarding URL
redirectToError()       - redirect to error URL
redirectToMfa()         - redirect to mfa URL
redirectToTeamInvitation() - redirect to teamInvitation URL

All require browser or framework-specific redirect capability.
Do not error.
