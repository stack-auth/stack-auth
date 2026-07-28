import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { captureError, HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      users: yupArray(yupObject({
        id: yupString().defined(),
        primary_email: yupString().nullable().defined(),
        display_name: yupString().nullable().defined(),
        is_admin: yupBoolean().defined(),
        roles: yupArray(yupString().defined()).defined(),
        permissions: yupArray(yupString().defined()).defined(),
        last_sign_in_at: yupString().nullable().defined(),
        signed_up_at: yupString().defined(),
      }).defined()).defined(),
      capped: yupBoolean().defined(),
      limit: yupNumber().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    try {
      const tenancy = req.auth.tenancy;
      const prisma = await getPrismaClientForTenancy(tenancy);
      const limit = 1000;
      const users = await prisma.projectUser.findMany({
        where: { tenancyId: tenancy.id },
        include: {
          contactChannels: {
            where: { type: "EMAIL" as const, isPrimary: "TRUE" as const },
          },
          teamMembers: {
            include: {
              team: true,
              teamMemberDirectPermissions: true,
            },
          },
          directPermissions: true,
        },
        orderBy: { signedUpAt: "desc" },
        take: limit + 1,
      });
      const capped = users.length > limit;
      const rows = users.slice(0, limit);
      const lastSignInByUser = new Map<string, string>();
      try {
        const result = await getClickhouseAdminClient().query({
          query: `
            SELECT
              user_id,
              max(event_at) AS last
            FROM analytics_internal.events
            WHERE project_id = {projectId:String}
              AND branch_id = {branchId:String}
              AND event_type = '$sign-in-attempt'
              AND CAST(data.outcome, 'Nullable(String)') = 'success'
              AND user_id != ''
            GROUP BY user_id
          `,
          query_params: {
            projectId: tenancy.project.id,
            branchId: tenancy.branchId,
          },
          format: "JSONEachRow",
        });
        const signInRows: Array<{ user_id: string, last: string }> = await result.json();
        for (const signInRow of signInRows) {
          lastSignInByUser.set(signInRow.user_id, new Date(signInRow.last).toISOString());
        }
      } catch (error) {
        // Sign-in events only exist since $sign-in-attempt logging began. A
        // ClickHouse outage should not prevent the Postgres access review list.
        captureError("compliance-access-review-last-sign-in-query", new HexclaveAssertionError(
          "Failed to load last sign-in timestamps.",
          { cause: error },
        ));
      }
      return {
        statusCode: 200 as const,
        bodyType: "json" as const,
        body: {
          users: rows.map((user) => ({
            id: user.projectUserId,
            primary_email: user.contactChannels[0]?.value ?? null,
            display_name: user.displayName,
            is_admin: user.teamMembers.some((member) => member.teamMemberDirectPermissions.some((permission) => permission.permissionId === "team_admin")),
            roles: user.teamMembers.map((member) => member.team.displayName),
            permissions: [
              ...user.directPermissions.map((permission) => permission.permissionId),
              ...user.teamMembers.flatMap((member) => member.teamMemberDirectPermissions.map((permission) => permission.permissionId)),
            ],
            // This only reflects sign-ins since $sign-in-attempt logging began.
            last_sign_in_at: lastSignInByUser.get(user.projectUserId) ?? null,
            signed_up_at: user.signedUpAt.toISOString(),
          })),
          capped,
          limit,
        },
      };
    } catch (error) {
      captureError("compliance-access-review-query", new HexclaveAssertionError(
        "Failed to load access review users.",
        { cause: error },
      ));
      throw new StatusError(StatusError.ServiceUnavailable, "Access review is temporarily unavailable.");
    }
  },
});
