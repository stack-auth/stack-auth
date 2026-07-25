import { computeRestrictedStatus } from "@/app/api/latest/users/crud";
import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { captureError, HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupRecord, yupString } from "@hexclave/shared/dist/schema-fields";

const MAX_EVENT_ROWS = 5000;
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type AccessDeniedEventRow = {
  event_at: string,
  event_type: "$access-denied" | "$sign-up-rule-trigger",
  reason: string | null,
  action: string | null,
  rule_id: string | null,
  email: string | null,
  auth_method: string | null,
  oauth_provider: string | null,
  permission_id: string | null,
  team_id: string | null,
  restricted_reason: string | null,
  ip: string | null,
  country_code: string | null,
  region_code: string | null,
  city_name: string | null,
  user_id: string | null,
};

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      from: yupString().optional(),
      to: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      events: yupArray(yupObject({
        event_at: yupString().defined(),
        category: yupString().oneOf(["access_denied", "sign_up_rule"]).defined(),
        reason: yupString().nullable().defined(),
        rule_id: yupString().nullable().defined(),
        email: yupString().nullable().defined(),
        auth_method: yupString().nullable().defined(),
        oauth_provider: yupString().nullable().defined(),
        permission_id: yupString().nullable().defined(),
        team_id: yupString().nullable().defined(),
        restricted_reason: yupString().nullable().defined(),
        ip: yupString().nullable().defined(),
        country_code: yupString().nullable().defined(),
        region_code: yupString().nullable().defined(),
        city_name: yupString().nullable().defined(),
        user_id: yupString().nullable().defined(),
      }).defined()).defined(),
      restricted_users: yupArray(yupObject({
        id: yupString().defined(),
        primary_email: yupString().nullable().defined(),
        display_name: yupString().nullable().defined(),
        restricted_reason: yupString().defined(),
        signed_up_at: yupString().defined(),
      }).defined()).defined(),
      summary: yupRecord(yupString().defined(), yupNumber().defined()).defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const tenancy = req.auth.tenancy;
    const now = new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(now.getTime() - DEFAULT_WINDOW_MS);
    // Date-only dashboard bounds represent calendar days, so include the whole selected end day.
    const to = req.query.to
      ? /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
        ? new Date(`${req.query.to}T23:59:59.999Z`)
        : new Date(req.query.to)
      : now;
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
      throw new StatusError(StatusError.BadRequest, "Invalid compliance event date range.");
    }

    let rawRows: AccessDeniedEventRow[];
    try {
      const result = await getClickhouseAdminClient().query({
        query: `
          SELECT
            event_at,
            event_type,
            NULLIF(CAST(data.reason, 'Nullable(String)'), '') AS reason,
            NULLIF(CAST(data.action, 'Nullable(String)'), '') AS action,
            COALESCE(
              NULLIF(CAST(data.rule_id, 'Nullable(String)'), ''),
              NULLIF(CAST(data.ruleId, 'Nullable(String)'), '')
            ) AS rule_id,
            NULLIF(CAST(data.email, 'Nullable(String)'), '') AS email,
            COALESCE(
              NULLIF(CAST(data.auth_method, 'Nullable(String)'), ''),
              NULLIF(CAST(data.authMethod, 'Nullable(String)'), '')
            ) AS auth_method,
            COALESCE(
              NULLIF(CAST(data.oauth_provider, 'Nullable(String)'), ''),
              NULLIF(CAST(data.oauthProvider, 'Nullable(String)'), '')
            ) AS oauth_provider,
            COALESCE(
              NULLIF(CAST(data.permission_id, 'Nullable(String)'), ''),
              NULLIF(CAST(data.permissionId, 'Nullable(String)'), '')
            ) AS permission_id,
            COALESCE(
              NULLIF(CAST(data.team_id, 'Nullable(String)'), ''),
              NULLIF(CAST(data.teamId, 'Nullable(String)'), '')
            ) AS team_id,
            COALESCE(
              NULLIF(CAST(data.restricted_reason, 'Nullable(String)'), ''),
              NULLIF(CAST(data.restrictedReason, 'Nullable(String)'), '')
            ) AS restricted_reason,
            NULLIF(CAST(data.ip_info.ip, 'Nullable(String)'), '') AS ip,
            NULLIF(CAST(data.ip_info.country_code, 'Nullable(String)'), '') AS country_code,
            NULLIF(CAST(data.ip_info.region_code, 'Nullable(String)'), '') AS region_code,
            NULLIF(CAST(data.ip_info.city_name, 'Nullable(String)'), '') AS city_name,
            NULLIF(user_id, '') AS user_id
          FROM analytics_internal.events
          WHERE project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND event_type IN ('$access-denied', '$sign-up-rule-trigger')
            AND event_at >= {from:DateTime}
            AND event_at <= {to:DateTime}
            AND (
              event_type = '$access-denied'
              OR CAST(data.action, 'Nullable(String)') IN ('reject', 'restrict')
            )
          ORDER BY event_at ASC
          LIMIT ${MAX_EVENT_ROWS}
        `,
        query_params: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          from: from.toISOString().slice(0, 19),
          to: to.toISOString().slice(0, 19),
        },
        format: "JSONEachRow",
      });
      rawRows = await result.json();
    } catch (error) {
      captureError("compliance-access-denied-clickhouse-query", new HexclaveAssertionError(
        "Failed to load compliance access-denied events.",
        { cause: error, projectId: tenancy.project.id, branchId: tenancy.branchId },
      ));
      throw new StatusError(StatusError.ServiceUnavailable, "Compliance events are temporarily unavailable.");
    }

    const events = rawRows.map((row) => ({
      event_at: new Date(row.event_at).toISOString(),
      category: row.event_type === "$access-denied" ? "access_denied" as const : "sign_up_rule" as const,
      reason: row.event_type === "$access-denied" ? row.reason : row.action,
      rule_id: row.rule_id,
      email: row.email,
      auth_method: row.auth_method,
      oauth_provider: row.oauth_provider,
      permission_id: row.permission_id,
      team_id: row.team_id,
      restricted_reason: row.restricted_reason,
      ip: row.ip,
      country_code: row.country_code,
      region_code: row.region_code,
      city_name: row.city_name,
      user_id: row.user_id,
    }));

    const summary: Record<string, number> = {};
    for (const event of events) {
      const key = event.reason ?? "unknown";
      summary[key] = (summary[key] ?? 0) + 1;
    }

    const prisma = await getPrismaClientForTenancy(tenancy);
    const restrictedUsers = await prisma.projectUser.findMany({
      where: {
        tenancyId: tenancy.id,
        OR: [
          ...(tenancy.config.onboarding.requireEmailVerification ? [{
            NOT: {
              contactChannels: {
                some: {
                  type: "EMAIL" as const,
                  isPrimary: "TRUE" as const,
                  isVerified: true,
                },
              },
            },
          }] : []),
          { restrictedByAdmin: true },
          { isAnonymous: true },
        ],
      },
      include: {
        contactChannels: {
          where: {
            type: "EMAIL" as const,
            isPrimary: "TRUE" as const,
          },
        },
      },
      orderBy: { signedUpAt: "desc" },
      take: MAX_EVENT_ROWS,
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        events,
        restricted_users: restrictedUsers.map((user) => {
          const primaryEmail = user.contactChannels.find((channel) => channel.isPrimary);
          const restrictedStatus = computeRestrictedStatus(
            user.isAnonymous,
            primaryEmail?.isVerified ?? false,
            tenancy.config,
            user.restrictedByAdmin,
          );
          if (!restrictedStatus.isRestricted) {
            throw new HexclaveAssertionError("Restricted-user query returned an unrestricted user.");
          }
          return {
            id: user.projectUserId,
            primary_email: primaryEmail?.value ?? null,
            display_name: user.displayName,
            restricted_reason: restrictedStatus.restrictedReason.type,
            signed_up_at: user.signedUpAt.toISOString(),
          };
        }),
        summary,
      },
    };
  },
});
