export const signUpAuthMethodValues = [
  "password",
  "otp",
  "oauth",
  "passkey",
] as const;

export type SignUpAuthMethod = typeof signUpAuthMethodValues[number];
