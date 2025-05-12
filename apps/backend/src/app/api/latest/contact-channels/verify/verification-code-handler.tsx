import { sendEmailFromTemplate } from "@/lib/emails";
import { getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { prismaClient } from "@/prisma-client";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { emailSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

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
  }).defined(),
  method: yupObject({
    email: emailSchema.defined(),
  }),
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
      templateType: "email_verification",
      extraVariables: {
        emailVerificationLink: codeObj.link.toString(),
      },
    });
  },
  async handler(tenancy, { email }, data) {
    await prismaClient.contactChannel.update({
      where: {
        tenancyId_projectUserId_type_value: {
          tenancyId: tenancy.id,
          projectUserId: data.user_id,
          type: "EMAIL",
          value: email,
        },
      },
      data: {
        isVerified: true,
      }
    });

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
