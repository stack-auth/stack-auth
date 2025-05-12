import { emailSchema, yupBoolean, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
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
