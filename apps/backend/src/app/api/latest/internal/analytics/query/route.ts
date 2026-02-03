import { getClickhouseExternalClient, getQueryTimingStats } from "@/lib/clickhouse";
import { getClickhouseExternalClient, isClickhouseConfigured } from "@/lib/clickhouse";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, jsonSchema, yupBoolean, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { randomUUID } from "crypto";

const MAX_QUERY_TIMEOUT_MS = 120_000;
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
      throw new StackAssertionError("include_all_branches is not supported yet");
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
        max_execution_time: body.timeout_ms / 1000,
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

const SAFE_CLICKHOUSE_ERROR_CODES = [
  62, // SYNTAX_ERROR
  159, // TIMEOUT_EXCEEDED
  164, // READONLY
  158, // TOO_MANY_ROWS
  396, // TOO_MANY_ROWS_OR_BYTES
  636, // CANNOT_EXTRACT_TABLE_STRUCTURE
];

const UNSAFE_CLICKHOUSE_ERROR_CODES = [
  36, // BAD_ARGUMENTS
  60, // UNKNOWN_TABLE
  497, // ACCESS_DENIED
];

const DEFAULT_CLICKHOUSE_ERROR_MESSAGE = "Error during execution of this query.";
const MAX_RESULT_ROWS = 10_000;
const MAX_RESULT_BYTES = 10 * 1024 * 1024;

function getSafeClickhouseErrorMessage(error: unknown, query: string) {
  if (typeof error !== "object" || error === null || !("code" in error) || typeof error.code !== "string" || isNaN(Number(error.code)) || !("message" in error) || typeof error.message !== "string") {
    captureError("unknown-clickhouse-error-for-query-not-clickhouse-error", new StackAssertionError("Unknown error from Clickhouse is not a Clickhouse error", { cause: error, query: query }));
    return DEFAULT_CLICKHOUSE_ERROR_MESSAGE;
  }

  const errorCode = Number(error.code);
  const message = error.message;
  if (SAFE_CLICKHOUSE_ERROR_CODES.includes(errorCode)) {
    return message;
  }
  const isKnown = UNSAFE_CLICKHOUSE_ERROR_CODES.includes(errorCode);
  if (!isKnown) {
    captureError("unknown-clickhouse-error-for-query", new StackAssertionError(`Unknown Clickhouse error: code ${errorCode} not in safe or unsafe codes`, { cause: error, query: query }));
  }

  if (getNodeEnvironment() === "development" || getNodeEnvironment() === "test") {
    return `${DEFAULT_CLICKHOUSE_ERROR_MESSAGE}${!isKnown ? "\n\nThis error is not known and you should probably add it to the safe or unsafe codes in analytics/query/route.ts." : ""}\n\nAs you are in development mode, you can see the full error: ${errorCode} ${message}`;
  }
  return DEFAULT_CLICKHOUSE_ERROR_MESSAGE;
}
