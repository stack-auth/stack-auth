import { teamMembershipsCrudHandlers } from "@/app/api/latest/team-memberships/crud";
import { sendEmailFromTemplate } from "@/lib/emails";
import { getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { prismaClient } from "@/prisma-client";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { emailSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { teamsCrudHandlers } from "../../teams/crud";

export const teamInvitationCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      summary: "Accept the team invitation",
      description: "Accept invitation and add user to the team",
      tags: ["Teams"],
    },
    check: {
      summary: "Check if a team invitation code is valid",
      description: "Check if a team invitation code is valid without using it",
      tags: ["Teams"],
    },
    details: {
      summary: "Get team invitation details",
      description: "Get additional information about a team invitation code",
      tags: ["Teams"],
    },
  },
  type: VerificationCodeType.TEAM_INVITATION,
  data: yupObject({
    team_id: yupString().defined(),
  }).defined(),
  method: yupObject({
    email: emailSchema.defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({}).defined(),
  }),
  detailsResponse: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      team_id: yupString().defined(),
      team_display_name: yupString().defined(),
    }).defined(),
  }),
  async send(codeObj, createOptions, sendOptions) {
    const team = await teamsCrudHandlers.adminRead({
      project: createOptions.project,
      branchId: createOptions.branchId,
      team_id: createOptions.data.team_id,
    });

    await sendEmailFromTemplate({
      tenancy: await getSoleTenancyFromProjectBranch(createOptions.project, createOptions.branchId),
      user: null,
      email: createOptions.method.email,
      templateType: "team_invitation",
      extraVariables: {
        teamInvitationLink: codeObj.link.toString(),
        teamDisplayName: team.display_name,
      },
    });

    return codeObj;
  },
  async handler(tenancy, {}, data, body, user) {
    if (!user) throw new KnownErrors.UserAuthenticationRequired;

    const oldMembership = await prismaClient.teamMember.findUnique({
      where: {
        tenancyId_projectUserId_teamId: {
          tenancyId: tenancy.id,
          projectUserId: user.id,
          teamId: data.team_id,
        },
      },
    });

    if (!oldMembership) {
      await teamMembershipsCrudHandlers.adminCreate({
        tenancy,
        team_id: data.team_id,
        user_id: user.id,
        data: {},
      });
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {}
    };
  },
  async details(tenancy, {}, data, body, user) {
    if (!user) throw new KnownErrors.UserAuthenticationRequired;

    const team = await teamsCrudHandlers.adminRead({
      tenancy,
      team_id: data.team_id,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        team_id: team.id,
        team_display_name: team.display_name,
      },
    };
  }
});
