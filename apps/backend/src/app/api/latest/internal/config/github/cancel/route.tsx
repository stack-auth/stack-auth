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
 * result is ignored) and hard-stops its sandbox if one was recorded. No revert:
 * any commit the agent already pushed stays and is reconciled by the repo's
 * stack-auth-config-sync workflow.
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

    const { cancelled, sandboxId } = await cancelConfigAgentRun({ projectId, branchId, nowMs: Date.now() });
    if (!cancelled) {
      return { statusCode: 200, bodyType: "json", body: { status: "not-running" } };
    }

    if (sandboxId) {
      runAsynchronouslyAndWaitUntil(stopConfigAgentSandbox(sandboxId));
    } else {
      captureError("config-github-cancel", new Error("Cancelled a config agent run but no sandboxId was recorded; the sandbox may still be running."));
    }

    return { statusCode: 200, bodyType: "json", body: { status: "cancelling" } };
  },
});
