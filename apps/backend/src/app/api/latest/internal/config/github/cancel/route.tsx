import {
  cancelConfigAgentRun,
  getBranchConfigOverrideSource,
} from "@/lib/config";
import { stopConfigAgentSandbox } from "@/lib/config/repo-agent";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const maxDuration = 60;

/**
 * Cancels the in-flight dashboard→GitHub config run. Atomically flips the run to
 * the terminal `cancelled` status (so the original run's late result is ignored)
 * and hard-stops its sandbox. There is no revert: if the agent hadn't pushed yet
 * the change is undone; if a commit already landed it stays (and the repo's
 * config-sync workflow will eventually reconcile it).
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

    const source = await getBranchConfigOverrideSource({ projectId, branchId });
    if (source.type !== "pushed-from-github") {
      throw new StatusError(StatusError.BadRequest, "This project's configuration is not linked to a GitHub repository.");
    }

    const { cancelled, sandboxId } = await cancelConfigAgentRun({ projectId, branchId, nowMs: Date.now() });
    if (!cancelled) {
      return { statusCode: 200, bodyType: "json", body: { status: "not-running" } };
    }

    if (sandboxId) {
      runAsynchronouslyAndWaitUntil(stopConfigAgentSandbox(sandboxId));
    }

    return { statusCode: 200, bodyType: "json", body: { status: "cancelling" } };
  },
});
