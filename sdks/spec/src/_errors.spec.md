# Common Errors

Errors used by many functions. Function-specific errors are defined inline.


## VerificationCodeError

code: "verification_code_error"
message: "The verification code is invalid or has expired."

Used by: verifyEmail, resetPassword, signInWithMagicLink, acceptTeamInvitation, etc.


## ApiError

code: <any unrecognized code>
message: <message from API response>

Generic wrapper for unexpected API errors.
Properties: code, message, details (optional object)
