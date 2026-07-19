import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { verifyFeatureFlagEvaluationToken } from "@/lib/feature-flags/exposure-tokens";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import { getHexclaveServerApp } from "@/hexclave";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_EXPOSURES = 500;
// Evaluation tokens are compact JWTs (~700 bytes); anything much larger is
// garbage and gets rejected before signature verification is even attempted.
const MAX_TOKEN_LENGTH = 4096;
// event_at_ms bounds: an exposure can't be reported from further in the past
// than the evaluation token could have lived (plus slack for retries), and
// only slightly in the future (clock skew). Everything else is rejected
// rather than clamped so client clock bugs surface instead of silently
// skewing attribution windows.
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_EVENT_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Upload feature flag exposure batch",
    description: "Records feature-flag exposure events. Each exposure must carry a signed evaluation token minted by the flag evaluation endpoint; the token binds the exposure to a project, subject, flag, variant, experiment run, and config revision.",
    tags: ["Feature Flags"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      user: adaptSchema,
    }).defined(),
    body: yupObject({
      batch_id: yupString().defined().matches(UUID_RE, "Invalid batch_id"),
      exposures: yupArray(
        yupObject({
          // Client-generated idempotency key: re-sending the same event_id
          // (e.g. on retry after a network error) never double-counts.
          event_id: yupString().defined().matches(UUID_RE, "Invalid event_id"),
          token: yupString().defined().min(1).max(MAX_TOKEN_LENGTH),
          event_at_ms: yupNumber().defined().integer().min(0),
        }).defined(),
      ).defined().min(1).max(MAX_EXPOSURES),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      inserted: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    // Exposures are stored in the analytics pipeline, so the analytics app
    // must be installed. INTEGRATION NOTE (feature-flags core workstream):
    // once a "feature-flags" app id exists in apps-config.ts, add
    // `!auth.tenancy.config.apps.installed["feature-flags"]?.enabled` here too.
    if (!auth.tenancy.config.apps.installed["analytics"]?.enabled) {
      throw new KnownErrors.AnalyticsNotEnabled();
    }

    const now = Date.now();
    for (const exposure of body.exposures) {
      if (exposure.event_at_ms < now - MAX_EVENT_AGE_MS || exposure.event_at_ms > now + MAX_EVENT_FUTURE_SKEW_MS) {
        throw new StatusError(StatusError.BadRequest, "Exposure event_at_ms is too far in the past or future");
      }
    }

    // All-or-nothing: if any token fails verification the whole batch is
    // rejected. Combined with event_id idempotency this keeps retries simple —
    // a client can always re-send the full batch after fixing the bad entry.
    const verified = await Promise.all(body.exposures.map(async (exposure) => ({
      exposure,
      payload: await verifyFeatureFlagEvaluationToken({ token: exposure.token, tenancy: auth.tenancy }),
    })));

    // Drop duplicate event_ids within the batch so a buggy client can't
    // multiply its quota debit; cross-batch duplicates are handled by the
    // ReplacingMergeTree dedupe contract on the exposures table.
    const seenEventIds = new Set<string>();
    const deduped = verified.filter(({ exposure }) => {
      const key = exposure.event_id.toLowerCase();
      if (seenEventIds.has(key)) return false;
      seenEventIds.add(key);
      return true;
    });

    const app = getHexclaveServerApp();
    const billingTeamId = getBillingTeamId(auth.tenancy.project);
    if (billingTeamId != null && arePlanLimitsEnforced()) {
      const eventsItem = await app.getItem({ itemId: ITEM_IDS.analyticsEvents, teamId: billingTeamId });
      const isDebited = await eventsItem.tryDecreaseQuantity(deduped.length);
      if (!isDebited) {
        throw new KnownErrors.ItemQuantityInsufficientAmount(ITEM_IDS.analyticsEvents, billingTeamId, deduped.length);
      }
    }

    const rows = deduped.map(({ exposure, payload }) => ({
      event_type: "$feature-flag-exposure",
      event_at: new Date(exposure.event_at_ms),
      data: {
        event_id: exposure.event_id.toLowerCase(),
        run_id: payload.run_id,
        config_revision_hash: payload.config_revision_hash,
        experiment_id: payload.experiment_id,
        flag_id: payload.flag_id,
        variant_id: payload.variant_id,
        subject_type: payload.subject_type,
        subject_hash: payload.subject_hash,
        // The evaluation reason/rule is informational; current tokens don't
        // carry it, so the MV maps the empty rule to NULL.
        rule_id: "",
        reason: "experiment",
      },
      project_id: auth.tenancy.project.id,
      branch_id: auth.tenancy.branchId,
      user_id: auth.user?.id ?? null,
      team_id: null,
      refresh_token_id: null,
      session_replay_id: null,
      session_replay_segment_id: null,
    }));

    const clickhouseClient = getClickhouseAdminClient();
    await clickhouseClient.insert({
      table: "analytics_internal.events",
      values: rows,
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        async_insert: 1,
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { inserted: rows.length },
    };
  },
});
