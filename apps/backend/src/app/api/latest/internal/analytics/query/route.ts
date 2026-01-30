import { getClickhouseExternalClient, getQueryTimingStats } from "@/lib/clickhouse";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, jsonSchema, yupBoolean, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { randomUUID } from "crypto";

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
      timeout_ms: yupNumber().integer().min(1_000).default(10_000),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      result: jsonSchema.defined(),
      stats: yupObject({
        cpu_time: yupNumber().defined(),
        wall_clock_time: yupNumber().defined(),
      }).defined(),
    }).defined(),
  }),
  async handler({ body, auth }) {
    if (body.include_all_branches) {
      throw new StackAssertionError("include_all_branches is not supported yet");
    }
    const client = getClickhouseExternalClient();
    const queryId = randomUUID();
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
      const message = getSafeClickhouseErrorMessage(resultSet.error);
      if (message === null) {
        throw new StackAssertionError("Unknown Clickhouse error", { cause: resultSet.error });
      }
      throw new KnownErrors.AnalyticsQueryError(message);
    }

    const rows = await resultSet.data.json<Record<string, unknown>[]>();
    const stats = await getQueryTimingStats(client, queryId);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        result: rows,
        stats: {
          cpu_time: stats.cpu_time_ms,
          wall_clock_time: stats.wall_clock_time_ms,
        },
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

function getSafeClickhouseErrorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error) || typeof error.code !== "string") {
    return null;
  }
  const errorCode = Number(error.code);
  if (isNaN(errorCode)) {
    return null;
  }
  const message = "message" in error && typeof error.message === "string" ? error.message : null;
  if (SAFE_CLICKHOUSE_ERROR_CODES.includes(errorCode)) {
    return message;
  }
  if (UNSAFE_CLICKHOUSE_ERROR_CODES.includes(errorCode)) {
    return DEFAULT_CLICKHOUSE_ERROR_MESSAGE;
  }
  return null;
}
