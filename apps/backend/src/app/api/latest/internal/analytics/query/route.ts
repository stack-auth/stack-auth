import { getClickhouseExternalClient } from "@/lib/clickhouse";
import { getSafeClickhouseErrorMessage } from "@/lib/clickhouse-errors";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { getHexclaveServerApp } from "@/hexclave";
import { KnownErrors } from "@hexclave/shared";
import { ITEM_IDS, PLAN_LIMITS } from "@hexclave/shared/dist/plans";
import { adaptSchema, adminAuthTypeSchema, jsonSchema, yupBoolean, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { Result } from "@hexclave/shared/dist/utils/results";
import { randomUUID } from "crypto";

const MAX_QUERY_TIMEOUT_MS = Math.max(...Object.values(PLAN_LIMITS).map(p => p.analyticsTimeoutSeconds)) * 1000;
const DEFAULT_QUERY_TIMEOUT_MS = 10_000;

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      include_all_branches: yupBoolean().default(false),
      query: yupString().defined().nonEmpty(),
      params: yupRecord(yupString().defined(), yupMixed().defined()).default({}),
      timeout_ms: yupNumber().integer().min(1_000).max(MAX_QUERY_TIMEOUT_MS).default(DEFAULT_QUERY_TIMEOUT_MS),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      result: jsonSchema.defined(),
      query_id: yupString().defined(),
    }).defined(),
  }),
  async handler({ body, auth }) {
    if (body.include_all_branches) {
      throw new HexclaveAssertionError("include_all_branches is not supported yet");
    }

    let effectiveTimeoutMs = body.timeout_ms;
    const billingTeamId = getBillingTeamId(auth.tenancy.project);
    if (billingTeamId != null && arePlanLimitsEnforced()) {
      const app = getHexclaveServerApp();
      const timeoutItem = await app.getItem({ itemId: ITEM_IDS.analyticsTimeoutSeconds, teamId: billingTeamId });
      // clickHouse treats max_execution_time=0 as
      // "unlimited", so a customer with zero timeout entitlement (no active
      // plan in the plans line, or a transient gap between paid-plan end
      // and free regrant) would otherwise get unbounded query execution.
      if (timeoutItem.quantity <= 0) {
        throw new KnownErrors.ItemQuantityInsufficientAmount(ITEM_IDS.analyticsTimeoutSeconds, billingTeamId, 1);
      }
      const maxAllowedMs = timeoutItem.quantity * 1000;
      effectiveTimeoutMs = Math.min(body.timeout_ms, maxAllowedMs);
    }

    const client = getClickhouseExternalClient();
    const queryId = `${auth.tenancy.project.id}:${auth.tenancy.branchId}:${randomUUID()}`;
    const resultSet = await Result.fromPromise(client.query({
      query: body.query,
      query_id: queryId,
      query_params: body.params,
      clickhouse_settings: {
        SQL_project_id: auth.tenancy.project.id,
        SQL_branch_id: auth.tenancy.branchId,
        max_execution_time: effectiveTimeoutMs / 1000,
        readonly: "1",
        allow_ddl: 0,
        max_result_rows: MAX_RESULT_ROWS.toString(),
        max_result_bytes: MAX_RESULT_BYTES.toString(),
        result_overflow_mode: "throw",
      },
      format: "JSONEachRow",
    }));

    if (resultSet.status === "error") {
      const message = getSafeClickhouseErrorMessage(resultSet.error, body.query);
      throw new KnownErrors.AnalyticsQueryError(message);
    }

    const rows = await resultSet.data.json<Record<string, unknown>[]>();
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        result: rows,
        query_id: queryId,
      },
    };
  },
});

const MAX_RESULT_ROWS = 10_000;
const MAX_RESULT_BYTES = 10 * 1024 * 1024;
