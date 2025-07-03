import { sendEmailFromTemplate } from "@/lib/emails";
import { Tenancy, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { createAuthTokens } from "@/lib/tokens";
import { prismaClient } from "@/prisma-client";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { emailSchema, signInResponseSchema, yupBoolean, yupNumber, yupObject, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { createMfaRequiredError } from "../../auth/mfa/sign-in/verification-code-handler";
import { usersCrudHandlers } from "../../users/crud";

export const contactChannelVerificationCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      summary: "Verify an email",
      description: "Verify an email address of a user",
      tags: ["Contact Channels"],
    },
    check: {
      summary: "Check email verification code",
      description: "Check if an email verification code is valid without using it",
      tags: ["Contact Channels"],
    },
  },
  type: VerificationCodeType.CONTACT_CHANNEL_VERIFICATION,
  data: yupObject({
    user_id: yupString().defined(),
    is_new_user: yupBoolean().defined(),
    is_auth: yupBoolean().defined(), // If true, the code is used during authentication, so return OTP and access token
  }).defined(),
  method: yupObject({
    email: emailSchema.defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupUnion(
      yupObject({}),
      signInResponseSchema.defined(),
    )
  }),
  async send(codeObj, createOptions, sendOptions: { user: UsersCrud["Admin"]["Read"] }) {
    const tenancy = await getSoleTenancyFromProjectBranch(createOptions.project.id, createOptions.branchId);

    await sendEmailFromTemplate({
      tenancy,
      user: sendOptions.user,
      email: createOptions.method.email,
      templateType: "email_verification",
      extraVariables: {
        emailVerificationLink: codeObj.link.toString(),
        otp: createOptions.data.is_auth ? codeObj.code.slice(0, 6).toUpperCase() : null,
      },
    });

    return {
      nonce: codeObj.code.slice(6),
    };
  },
  async handler(tenancy, method, data) {
    const uniqueKeys = {
      tenancyId_projectUserId_type_value: {
        tenancyId: tenancy.id,
        projectUserId: data.user_id,
        type: "EMAIL",
        value: method.email,
      },
    } as const;

    const contactChannel = await prismaClient.contactChannel.findUnique({
      where: uniqueKeys,
    });

    // This happens if the email is sent but then before the user clicks the link, the contact channel is deleted.
    if (!contactChannel) {
      throw new StatusError(400, "Contact channel not found. Was your contact channel deleted?");
    }

    await prismaClient.contactChannel.update({
      where: uniqueKeys,
      data: {
        isVerified: true,
      }
    });

    if (!data.is_auth) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {},
      };
    }

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

export async function throwEmailVerificationRequiredErrorIfNeeded(options: { tenancy: Tenancy, isNewUser: boolean, userId: string, callbackUrl: string }) {
  if (!options.tenancy.completeConfig.auth.emailVerificationRequired) {
    return;
  }

  const user = await usersCrudHandlers.adminRead({
    tenancy: options.tenancy,
    user_id: options.userId,
  });

  if (!user.primary_email) {
    captureError("user-has-no-primary-email", { userId: options.userId });
    return;
  }

  if (user.primary_email_verified) {
    return;
  }

  const result = await contactChannelVerificationCodeHandler.sendCode({
    tenancy: options.tenancy,
    data: {
      user_id: user.id,
      is_new_user: false,
      is_auth: true,
    },
    method: {
      email: user.primary_email!,
    },
    callbackUrl: options.callbackUrl,
  }, {
    user,
  });

  throw new KnownErrors.EmailVerificationRequired(result.nonce);
}
