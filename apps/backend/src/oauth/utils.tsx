import { emailSchema, yupBoolean, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import * as yup from 'yup';

export type OAuthUserInfo = yup.InferType<typeof OAuthUserInfoSchema>;

const OAuthUserInfoSchema = yupObject({
  accountId: yupString().min(1).defined(),
  displayName: yupString().nullable().default(null),
  email: emailSchema.nullable().default(null),
  profileImageUrl: yupString().nullable().default(null),
  emailVerified: yupBoolean().default(false),
});

export function validateUserInfo(
  userInfo: Partial<yup.InferType<typeof OAuthUserInfoSchema>>,
): OAuthUserInfo {
  return OAuthUserInfoSchema.validateSync(userInfo);
}

/**
 * Apple emits the `email_verified` claim as either a boolean or its string
 * representation ("true"/"false"). A naive `!!value` coerces the string "false"
 * into `true`, which would let an UNVERIFIED Apple email satisfy the account-merge
 * verification gate in `handleOAuthEmailMergeStrategy` and silently link into an
 * existing account (account takeover). Treat only a real `true` or the exact
 * string "true" as verified; anything else (including "false") is unverified.
 *
 * Shared between the web provider (`providers/apple.tsx`) and the native sign-in
 * route so the two can never drift apart again.
 */
export function isAppleEmailVerified(value: unknown): boolean {
  return value === true || value === "true";
}
