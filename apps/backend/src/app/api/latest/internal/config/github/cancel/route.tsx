import {
  cancelConfigAgentRun,
  getGithubConfigSourceOrThrow,
} from "@/lib/config";
import { stopConfigAgentSandbox } from "@/lib/config/repo-agent";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { captureError } from "@hexclave/shared/dist/utils/errors";

export const maxDuration = 60;

/**
 * Atomically flips the run to terminal `cancelled` (so the original run's late
 * result is ignored) and hard-stops its sandbox if one was recorded (only `running`
 * runs have a live sandbox; an `awaiting_review` run's sandbox is already gone, so
 * cancelling it just discards the captured change set before it is committed). No
 * commit has been pushed at this point, so there is nothing to revert.
 */
export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Cancel an in-flight config agent run",
    description: "Stops the running config agent sandbox for the linked GitHub repo.",
    tags: ["Config"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      run_id: yupString().uuid().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["cancelling", "not-running"]).defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const projectId = req.auth.tenancy.project.id;
    const branchId = req.auth.tenancy.branchId;

    await getGithubConfigSourceOrThrow({ projectId, branchId });

    const { cancelled, sandboxId, previousStatus } = await cancelConfigAgentRun({ projectId, branchId, runId: req.body.run_id, nowMs: Date.now() });
    if (!cancelled) {
      return { statusCode: 200, bodyType: "json", body: { status: "not-running" } };
    }

    if (sandboxId) {
      runAsynchronouslyAndWaitUntil(stopConfigAgentSandbox(sandboxId));
    } else if (previousStatus === "running") {
      // A `running` run should always have a sandbox recorded; missing one means it
      // may still be running. (An `awaiting_review` run has no live sandbox — the
      // change set was already captured and the sandbox stopped — so that's expected.)
      captureError("config-github-cancel", new Error("Cancelled a running config agent run but no sandboxId was recorded; the sandbox may still be running."));
    }

    return { statusCode: 200, bodyType: "json", body: { status: "cancelling" } };
  },
});
