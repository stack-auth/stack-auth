import { getWorkflowRunDetails, listWorkflowRuns } from "@/lib/workflows/api";
import { ensureWorkflowsEnabled } from "@/lib/workflows/gate";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { type WorkflowRunStateJson } from "@hexclave/shared/dist/interface/workflows";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const RUN_STATES = ["queued", "running", "sleeping", "completed", "failed", "canceled"] as const satisfies readonly WorkflowRunStateJson[];
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

function parsePositiveIntegerQuery(name: string, value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!POSITIVE_INTEGER_PATTERN.test(value) || !Number.isSafeInteger(parsed)) {
    throw new StatusError(400, `${name} must be a positive integer`);
  }
  return parsed;
}

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    // Server-or-admin: the dashboard uses admin auth; the in-sandbox
    // hexclaveApp uses per-run scoped server credentials.
    auth: yupObject({
      type: yupString().oneOf(["server", "admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      workflow_id: yupString().defined(),
    }).defined(),
    query: yupObject({
      state: yupString().oneOf(RUN_STATES).optional(),
      version: yupString().matches(POSITIVE_INTEGER_PATTERN).optional(),
      run_key: yupString().optional(),
      only_active: yupString().oneOf(["true", "false"]).optional(),
      cursor: yupString().optional(),
      limit: yupString().matches(POSITIVE_INTEGER_PATTERN).optional(),
      include_state: yupString().oneOf(["true", "false"]).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      runs: yupArray(yupMixed().defined()).defined(),
      next_cursor: yupString().nullable().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params, query }) {
    ensureWorkflowsEnabled(tenancy.project.id);
    const { runs, nextCursor } = await listWorkflowRuns(tenancy, params.workflow_id, {
      state: query.state,
      version: parsePositiveIntegerQuery("version", query.version),
      runKey: query.run_key,
      onlyActive: query.only_active === "true",
      cursor: query.cursor,
      limit: parsePositiveIntegerQuery("limit", query.limit),
    });
    // include_state (spec: "listRuns exposes memoized state bags") is
    // served by joining each run's details; runs-with-state requests are
    // page-sized, so N+1 here is bounded and rare.
    let runsWithState = runs;
    if (query.include_state === "true") {
      runsWithState = await Promise.all(runs.map(async (run) => await getWorkflowRunDetails(tenancy, run.id)));
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        runs: runsWithState,
        next_cursor: nextCursor,
      },
    };
  },
});
