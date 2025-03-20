import { sendEmailFromTemplate } from "@/lib/emails";
import { getSoleTenancyFromProject } from "@/lib/tenancies";
import { createAuthTokens } from "@/lib/tokens";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { emailSchema, signInResponseSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { usersCrudHandlers } from "../../../users/crud";
import { createMfaRequiredError } from "../../mfa/sign-in/verification-code-handler";

export const signInVerificationCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      summary: "Sign in with a code",
      description: "Sign in with a code",
      tags: ["OTP"],
    },
    check: {
      summary: "Check sign in code",
      description: "Check if a sign in code is valid without using it",
      tags: ["OTP"],
    }
  },
  type: VerificationCodeType.ONE_TIME_PASSWORD,
  data: yupObject({
    user_id: yupString().uuid().optional(),
    is_new_user: yupBoolean().defined(),
  }),
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
    const tenancy = await getSoleTenancyFromProject(createOptions.project);
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
  async handler(tenancy, { email }, data) {
    let user;
    // the user_id check is just for the migration
    // we can rely only on is_new_user starting from the next release
    if (!data.user_id) {
      if (!data.is_new_user) {
        throw new StackAssertionError("When user ID is not provided, the user must be new");
      }

      user = await usersCrudHandlers.adminCreate({
        tenancy,
        data: {
          primary_email: email,
          primary_email_verified: true,
          primary_email_auth_enabled: true,
          otp_auth_enabled: true,
        },
        allowedErrorTypes: [KnownErrors.UserWithEmailAlreadyExists],
      });
    } else {
      user = await usersCrudHandlers.adminRead({
        tenancy,
        user_id: data.user_id,
        // This might happen if the user was deleted but the code is still valid
        allowedErrorTypes: [KnownErrors.UserNotFound],
      });
    }

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
      projectUserId: user.id,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        refresh_token: refreshToken,
        access_token: accessToken,
        is_new_user: data.is_new_user,
        user_id: user.id,
      },
    };
  },
});
