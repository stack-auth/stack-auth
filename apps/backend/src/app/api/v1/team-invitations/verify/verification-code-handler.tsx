import * as yup from "yup";
import { prismaClient } from "@/prisma-client";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { sendEmailFromTemplate } from "@/lib/emails";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const teamInvitationCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      summary: "Invite a user to a team",
      description: "Send an email to a user to invite them to a team",
      tags: ["Teams"],
    },
    check: {
      summary: "Check if a team invitation code is valid",
      description: "Check if a team invitation code is valid without using it",
      tags: ["Teams"],
    },
  },
  userRequired: true,
  type: VerificationCodeType.TEAM_INVITATION,
  data: yupObject({}).required(),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).required(),
    bodyType: yupString().oneOf(["success"]).required(),
  }),
  async send(codeObj, createOptions, sendOptions: { user: UsersCrud["Admin"]["Read"] }) {
    await sendEmailFromTemplate({
      project: createOptions.project,
      user: sendOptions.user,
      email: createOptions.method.email,
      templateType: "email_verification",
      extraVariables: {
        emailVerificationLink: codeObj.link.toString(),
      },
    });
  },
  async handler(project, { email }, data, body, user) {

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
