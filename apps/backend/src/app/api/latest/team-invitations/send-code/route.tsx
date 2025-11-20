import { ensureUserTeamPermissionExists } from "@/lib/request-checks";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, permissionDefinitionIdSchema, teamIdSchema, teamInvitationCallbackUrlSchema, teamInvitationEmailSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { teamInvitationCodeHandler } from "../accept/verification-code-handler";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { listPermissionDefinitionsFromConfig } from "@/lib/permissions";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Send an email to invite a user to a team",
    description: "The user receiving this email can join the team by clicking on the link in the email. If the user does not have an account yet, they will be prompted to create one.",
    tags: ["Teams"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
      user: adaptSchema.optional(),
    }).defined(),
    body: yupObject({
      team_id: teamIdSchema.defined(),
      email: teamInvitationEmailSchema.defined(),
      callback_url: teamInvitationCallbackUrlSchema.defined(),
      permission_ids: yupArray(permissionDefinitionIdSchema.defined()).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
      id: yupString().uuid().defined(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    await retryTransaction(prisma, async (tx) => {
      if (auth.type === "client") {
        if (!auth.user) throw new KnownErrors.UserAuthenticationRequired();
        if (body.permission_ids !== undefined) {
          throw new StatusError(StatusError.Forbidden, "permission_ids can only be set from server-side requests.");
        }

        await ensureUserTeamPermissionExists(tx, {
          tenancy: auth.tenancy,
          userId: auth.user.id,
          teamId: body.team_id,
          permissionId: "$invite_members",
          errorType: 'required',
          recursive: true,
        });
      }
    });

    if (body.permission_ids !== undefined) {
      const validPermissionIds = new Set(
        listPermissionDefinitionsFromConfig({
          config: auth.tenancy.config,
          scope: "team",
        }).map((permission) => permission.id),
      );
      for (const permissionId of body.permission_ids) {
        if (!validPermissionIds.has(permissionId)) {
          throw new KnownErrors.PermissionNotFound(permissionId);
        }
      }
    }

    const codeObj = await teamInvitationCodeHandler.sendCode({
      tenancy: auth.tenancy,
      data: {
        team_id: body.team_id,
        permission_ids: body.permission_ids || [],
      },
      method: {
        email: body.email,
      },
      callbackUrl: body.callback_url,
    }, {});

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
        id: codeObj.id,
      },
    };
  },
});
