import { createAuthTokens } from "@/lib/tokens";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { verifyTOTP } from "@oslojs/otp";
import { VerificationCodeType } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { signInResponseSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export const mfaVerificationCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      summary: "MFA sign in",
      description: "Complete multi-factor authorization to sign in, with a TOTP and an MFA attempt code",
      tags: ["OTP"],
    },
    check: {
      summary: "Verify MFA",
      description: "Check if the MFA attempt is valid without using it",
      tags: ["OTP"],
    }
  },
  type: VerificationCodeType.ONE_TIME_PASSWORD,
  data: yupObject({
    user_id: yupString().defined(),
    is_new_user: yupBoolean().defined(),
  }),
  method: yupObject({}),
  requestBody: yupObject({
    type: yupString().oneOf(["totp"]).defined(),
    totp: yupString().defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: signInResponseSchema.defined(),
  }),
  async validate(tenancy, method, data, body) {
    const prisma = getPrismaClientForTenancy(tenancy);
    const user = await prisma.projectUser.findUniqueOrThrow({
      where: {
        tenancyId_projectUserId: {
          tenancyId: tenancy.id,
          projectUserId: data.user_id,
        },
      },
    });
    const totpSecret = user.totpSecret;
    if (!totpSecret) {
      throw new StackAssertionError("User does not have a TOTP secret", { user });
    }
    const isTotpValid = verifyTOTP(totpSecret, 30, 6, body.totp);
    if (!isTotpValid) {
      throw new KnownErrors.InvalidTotpCode();
    }
  },
  async handler(tenancy, {}, data, body) {
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

export async function createMfaRequiredError(options: { project: Omit<ProjectsCrud["Admin"]["Read"], "config">, branchId: string, isNewUser: boolean, userId: string }) {
  const attemptCode = await mfaVerificationCodeHandler.createCode({
    expiresInMs: 1000 * 60 * 5,
    project: options.project,
    branchId: options.branchId,
    data: {
      user_id: options.userId,
      is_new_user: options.isNewUser,
    },
    method: {},
    callbackUrl: undefined,
  });
  return new KnownErrors.MultiFactorAuthenticationRequired(attemptCode.code);
}
