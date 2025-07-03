import { sendEmailFromTemplate } from "@/lib/emails";
import { Tenancy, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { createAuthTokens } from "@/lib/tokens";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { signInResponseSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { usersCrudHandlers } from "../../../users/crud";
import { createMfaRequiredError } from "../../mfa/sign-in/verification-code-handler";

export const emailVerificationRequiredVerificationCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      summary: "Sign in with email verification",
      description: "Complete email verification to sign in, with a TOTP and an emailVerificationRequired attempt code",
      tags: ["OTP"],
    },
    check: {
      summary: "Verify email verification",
      description: "Check if the email verification attempt is valid without using it",
      tags: ["OTP"],
    }
  },
  type: VerificationCodeType.ONE_TIME_PASSWORD,
  data: yupObject({
    user_id: yupString().defined(),
    is_new_user: yupBoolean().defined(),
    email: yupString().defined(),
  }),
  method: yupObject({}),
  requestBody: yupObject({
    totp: yupString().defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: signInResponseSchema.defined(),
  }),
  async send(codeObj, createOptions, sendOptions: { email: string }) {
    const tenancy = await getSoleTenancyFromProjectBranch(createOptions.project.id, createOptions.branchId);
    await sendEmailFromTemplate({
      tenancy,
      email: sendOptions.email,
      user: null,
      templateType: "email_verification",
      extraVariables: {
        emailVerificationLink: codeObj.link.toString(),
        otp: codeObj.code.slice(0, 6).toUpperCase(),
      },
    });

    return {
      nonce: codeObj.code.slice(6),
    };
  },
  async handler(tenancy, {}, data, body) {
    const user = await usersCrudHandlers.adminRead({
      tenancy,
      user_id: data.user_id,
    });

    if (user.requires_totp_mfa) {
      throw await createMfaRequiredError({
        project: tenancy.project,
        branchId: tenancy.branchId,
        isNewUser: data.is_new_user,
        userId: user.id,
      });
    }

    const { refreshToken, accessToken } = await createAuthTokens({
      tenancy,
      projectUserId: data.user_id,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        refresh_token: refreshToken,
        access_token: accessToken,
        is_new_user: data.is_new_user,
        user_id: data.user_id,
      },
    };
  },
});

export async function throwEmailVerificationRequiredErrorIfNeeded(options: { tenancy: Tenancy, isNewUser: boolean, userId: string }) {
  const user = await usersCrudHandlers.adminRead({
    tenancy: options.tenancy,
    user_id: options.userId,
  });
  const primaryEmail = user.primary_email;

  if (!user.requires_email_verification) {
    return;
  }

  if (!primaryEmail) {
    captureError("user-has-no-primary-email", { userId: options.userId });
    return;
  }

  if (user.primary_email_verified) {
    return;
  }

  const attemptCode = await emailVerificationRequiredVerificationCodeHandler.createCode({
    expiresInMs: 1000 * 60 * 5,
    project: options.tenancy.project,
    branchId: options.tenancy.branchId,
    data: {
      user_id: options.userId,
      is_new_user: options.isNewUser,
      email: primaryEmail,
    },
    method: {},
    callbackUrl: undefined,
  });
  throw new KnownErrors.EmailVerificationRequired(attemptCode.code);
}
