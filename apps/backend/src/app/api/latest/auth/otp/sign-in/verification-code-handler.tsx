import { getAuthContactChannel } from "@/lib/contact-channel";
import { sendEmailFromTemplate } from "@/lib/emails";
import { getSoleTenancyFromProjectBranch, Tenancy } from "@/lib/tenancies";
import { createAuthTokens } from "@/lib/tokens";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { emailSchema, signInResponseSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { usersCrudHandlers } from "../../../users/crud";
import { createMfaRequiredError } from "../../mfa/sign-in/verification-code-handler";

export async function ensureUserForEmailAllowsOtp(tenancy: Tenancy, email: string): Promise<UsersCrud["Admin"]["Read"] | null> {
  const prisma = getPrismaClientForTenancy(tenancy);
  const contactChannel = await getAuthContactChannel(
    prisma,
    {
      tenancyId: tenancy.id,
      type: "EMAIL",
      value: email,
    }
  );

  if (contactChannel) {
    const otpAuthMethod = contactChannel.projectUser.authMethods.find((m) => m.otpAuthMethod)?.otpAuthMethod;

    if (contactChannel.isVerified) {
      if (!otpAuthMethod) {
        // automatically merge the otp auth method with the existing account

        await prisma.authMethod.create({
          data: {
            projectUserId: contactChannel.projectUser.projectUserId,
            tenancyId: tenancy.id,
            otpAuthMethod: {
              create: {
                projectUserId: contactChannel.projectUser.projectUserId,
              }
            }
          },
        });
      }

      return await usersCrudHandlers.adminRead({
        tenancy,
        user_id: contactChannel.projectUser.projectUserId,
      });
    } else {
      throw new KnownErrors.UserWithEmailAlreadyExists(contactChannel.value, true);
    }
  } else {
    if (!tenancy.config.sign_up_enabled) {
      throw new KnownErrors.SignUpNotEnabled();
    }
    return null;
  }
}

export const signInVerificationCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      summary: "Sign in with a code",
      description: "",
      tags: ["OTP"],
    },
    check: {
      summary: "Check sign in code",
      description: "Check if a sign in code is valid without using it",
      tags: ["OTP"],
    },
    codeDescription: `A 45-character verification code. For magic links, this is the code found in the "code" URL query parameter. For OTP, this is formed by concatenating the 6-digit code entered by the user with the nonce (received during code creation)`,
  },
  type: VerificationCodeType.ONE_TIME_PASSWORD,
  data: yupObject({}),
  method: yupObject({
    email: emailSchema.defined(),
    type: yupString().oneOf(["legacy", "standard"]).defined(),
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
      email: createOptions.method.email,
      user: null,
      templateType: "magic_link",
      extraVariables: {
        magicLink: codeObj.link.toString(),
        otp: codeObj.code.slice(0, 6).toUpperCase(),
      },
      version: createOptions.method.type === "legacy" ? 1 : undefined,
    });

    return {
      nonce: codeObj.code.slice(6),
    };
  },
  async handler(tenancy, { email }) {
    let user = await ensureUserForEmailAllowsOtp(tenancy, email);
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      user = await usersCrudHandlers.adminCreate({
        tenancy,
        data: {
          primary_email: email,
          primary_email_verified: true,
          primary_email_auth_enabled: true,
          otp_auth_enabled: true,
        },
      });
    }

    if (user.requires_totp_mfa) {
      throw await createMfaRequiredError({
        project: tenancy.project,
        branchId: tenancy.branchId,
        userId: user.id,
        isNewUser,
      });
    }

    const { refreshToken, accessToken } = await createAuthTokens({
      tenancy,
      projectUserId: user.id,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        refresh_token: refreshToken,
        access_token: accessToken,
        is_new_user: isNewUser,
        user_id: user.id,
      },
    };
  },
});
