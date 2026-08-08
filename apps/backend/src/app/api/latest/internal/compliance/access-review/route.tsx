import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { listPermissions } from "@/lib/permissions";
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
        teams: yupArray(yupString().defined()).defined(),
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
        where: { tenancyId: tenancy.id, isAnonymous: false },
        include: {
          contactChannels: {
            where: { type: "EMAIL" as const, isPrimary: "TRUE" as const },
          },
          teamMembers: {
            include: {
              team: true,
            },
          },
        },
        orderBy: { signedUpAt: "desc" },
        take: limit + 1,
      });
      const capped = users.length > limit;
      const rows = users.slice(0, limit);
      const pageUserIds = rows.map((user) => user.projectUserId);
      const [projectPermissions, teamPermissions] = pageUserIds.length === 0
        ? [[], []]
        : await Promise.all([
          listPermissions(prisma, {
            tenancy,
            scope: "project",
            recursive: true,
            userIds: pageUserIds,
            // Compliance review evaluates full live authority, not an OAuth-token scope intersection.
            grantedScopes: null,
          }),
          listPermissions(prisma, {
            tenancy,
            scope: "team",
            recursive: true,
            userIds: pageUserIds,
            // Compliance review evaluates full live authority, not an OAuth-token scope intersection.
            grantedScopes: null,
          }),
        ]);
      const effectivePermissionsByUser = new Map<string, Set<string>>();
      for (const permission of projectPermissions) {
        const permissions = effectivePermissionsByUser.get(permission.user_id) ?? new Set<string>();
        permissions.add(permission.id);
        effectivePermissionsByUser.set(permission.user_id, permissions);
      }
      for (const permission of teamPermissions) {
        const permissions = effectivePermissionsByUser.get(permission.user_id) ?? new Set<string>();
        permissions.add(permission.id);
        effectivePermissionsByUser.set(permission.user_id, permissions);
      }
      const effectiveTeamPermissionsByUser = new Map<string, Set<string>>();
      for (const permission of teamPermissions) {
        const permissions = effectiveTeamPermissionsByUser.get(permission.user_id) ?? new Set<string>();
        permissions.add(permission.id);
        effectiveTeamPermissionsByUser.set(permission.user_id, permissions);
      }
      const lastSignInByUser = new Map<string, string>();
      if (rows.length > 0) {
        try {
          const client = getClickhouseAdminClient();
          try {
            const result = await client.query({
              query: `
            SELECT
              user_id,
              max(event_at) AS last
            FROM analytics_internal.events
            WHERE project_id = {projectId:String}
              AND branch_id = {branchId:String}
              AND event_type = '$sign-in-attempt'
              AND CAST(data.outcome, 'Nullable(String)') = 'success'
              AND event_at >= {retentionStart:DateTime}
              AND user_id IN {userIds:Array(String)}
            GROUP BY user_id
          `,
              query_params: {
                projectId: tenancy.project.id,
                branchId: tenancy.branchId,
                retentionStart: new Date(new Date().getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19),
                userIds: rows.map((user) => user.projectUserId),
              },
              format: "JSONEachRow",
            });
            const signInRows: Array<{ user_id: string, last: string }> = await result.json();
            for (const signInRow of signInRows) {
            lastSignInByUser.set(signInRow.user_id, new Date(signInRow.last).toISOString());
            }
          } finally {
            await client.close();
          }
        } catch (error) {
        // Sign-in events only exist since $sign-in-attempt logging began. A
        // ClickHouse outage should not prevent the Postgres access review list.
        captureError("compliance-access-review-last-sign-in-query", new HexclaveAssertionError(
          "Failed to load last sign-in timestamps.",
          { cause: error },
        ));
        }
      }
      return {
        statusCode: 200 as const,
        bodyType: "json" as const,
        body: {
          users: rows.map((user) => ({
            id: user.projectUserId,
            primary_email: user.contactChannels[0]?.value ?? null,
            display_name: user.displayName,
            is_admin: effectiveTeamPermissionsByUser.get(user.projectUserId)?.has("team_admin") ?? false,
            teams: user.teamMembers.map((member) => member.team.displayName),
            permissions: [...(effectivePermissionsByUser.get(user.projectUserId) ?? new Set<string>())].sort(),
            // This only reflects sign-ins since $sign-in-attempt logging began.
            last_sign_in_at: lastSignInByUser.get(user.projectUserId) ?? null,
            signed_up_at: user.signedUpAt.toISOString(),
          })),
          capped,
          limit,
        },
      };
    } catch (error) {
      if (error instanceof StatusError) throw error;
      captureError("compliance-access-review-query", new HexclaveAssertionError(
        "Failed to load access review users.",
        { cause: error },
      ));
      throw new HexclaveAssertionError("Access review is temporarily unavailable.", { cause: error });
    }
  },
});
