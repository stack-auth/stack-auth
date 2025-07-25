import { sendEmailFromTemplate } from "@/lib/emails";
import { getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { getPasswordError } from "@stackframe/stack-shared/dist/helpers/password";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { emailSchema, passwordSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { usersCrudHandlers } from "../../../users/crud";

export const resetPasswordVerificationCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      summary: "Reset password with a code",
      description: "Reset password with a code",
      tags: ["Password"],
    },
    check: {
      summary: "Check reset password code",
      description: "Check if a reset password code is valid without using it",
      tags: ["Password"],
    },
  },
  type: VerificationCodeType.PASSWORD_RESET,
  data: yupObject({
    user_id: yupString().defined(),
  }),
  method: yupObject({
    email: emailSchema.defined(),
  }),
  requestBody: yupObject({
    password: passwordSchema.defined(),
  }).defined(),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async send(codeObj, createOptions, sendOptions: { user: UsersCrud["Admin"]["Read"] }) {
    const tenancy = await getSoleTenancyFromProjectBranch(createOptions.project.id, createOptions.branchId);
    await sendEmailFromTemplate({
      tenancy,
      user: sendOptions.user,
      email: createOptions.method.email,
      templateType: "password_reset",
      extraVariables: {
        passwordResetLink: codeObj.link.toString(),
      },
    });
  },
  async handler(tenancy, { email }, data, { password }) {
    if (!tenancy.config.auth.password.allowSignIn) {
      throw new KnownErrors.PasswordAuthenticationNotEnabled();
    }

    const passwordError = getPasswordError(password);
    if (passwordError) {
      throw passwordError;
    }

    await usersCrudHandlers.adminUpdate({
      tenancy,
      user_id: data.user_id,
      data: {
        password,
      },
    });


    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
