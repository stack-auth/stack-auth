import {
  getCompleteBranchConfigForFile,
  getGithubConfigSourceOrThrow,
  recordConfigAgentRunProgress,
  recordConfigAgentRunResult,
  recordConfigAgentRunSandbox,
  recordConfigAgentRunStage,
  setConfigAgentRunAwaitingReview,
  startConfigAgentRun,
} from "@/lib/config";
import { applyConfigUpdate, type ConfigAgentInFlightStage, type GithubRepoRef } from "@/lib/config/repo-agent";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import type { EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { getInvalidConfigReason } from "@hexclave/shared/dist/config/format";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

// Background work (sandbox boot, clone, agent edit, capture the change set) continues
// via waitUntil after the immediate response, so allow a long invocation.
export const maxDuration = 800;

/**
 * Kicks off an AI-agent config write to the linked GitHub repo (writes go through
 * the agent in a Vercel Sandbox; reads use jiti). The agent edits the repo in the
 * sandbox; we then capture the change set and stop the sandbox, leaving the run
 * `awaiting_review` — the actual commit happens later via `/commit`. The GitHub token
 * is the user's own OAuth token, passed transiently for the clone — never persisted,
 * never placed in the agent's environment. The dashboard polls `agent_run` for progress.
 */
export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Apply config update via the GitHub repo agent",
    description: "Runs the config agent in a sandbox to commit a dashboard config change to the linked GitHub branch.",
    tags: ["Config"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      github_access_token: yupString().defined(),
      config_update_string: yupString().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["started"]).defined(),
      id: yupString().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const projectId = req.auth.tenancy.project.id;
    const branchId = req.auth.tenancy.branchId;

    await getGithubConfigSourceOrThrow({ projectId, branchId });

    let parsed: unknown;
    try {
      parsed = JSON.parse(req.body.config_update_string);
    } catch {
      throw new StatusError(StatusError.BadRequest, "config_update_string is not valid JSON.");
    }
    const reason = getInvalidConfigReason(parsed, { configName: "config_update_string" });
    if (reason) {
      throw new StatusError(StatusError.BadRequest, reason);
    }
    const configUpdate = parsed as EnvironmentConfigOverrideOverride;

    const githubToken = req.body.github_access_token;

    const nowMs = Date.now();
    // Inserts a fresh `running` run row and returns its id plus the source read in
    // the same FOR UPDATE txn (so a concurrent re-link can't redirect the push).
    // Runs aren't serialized; many can target this branch at once and a concurrent
    // commit is caught by GitHub at push time.
    const { source: startedSource, runId } = await startConfigAgentRun({ projectId, branchId, nowMs });
    const ref: GithubRepoRef = { owner: startedSource.owner, repo: startedSource.repo, branch: startedSource.branch };

    // Fetched fresh per boot; this admin route can't mint GitHub tokens for the
    // internal user (would be priv-esc), so we reuse the caller's freshest OAuth token.
    const getGithubToken = async () => githubToken;
    // Persist the sandbox id so a concurrent cancel can hard-stop it while the agent
    // runs. `applyConfigUpdate` owns the sandbox lifetime and always stops it before
    // returning/throwing, so the route doesn't need to track or stop it itself.
    const onSandboxId = async (sandboxId: string) => {
      await recordConfigAgentRunSandbox({ runId, sandboxId });
    };
    const onProgress = async (activity: string) => {
      await recordConfigAgentRunProgress({ runId, progress: activity });
    };
    const onStage = async (stage: ConfigAgentInFlightStage) => {
      await recordConfigAgentRunStage({ runId, stage });
    };

    runAsynchronouslyAndWaitUntil(async () => {
      try {
        // The file mirrors the COMPLETE branch config (current override merged with
        // this change), not just this delta.
        const completeConfig = await getCompleteBranchConfigForFile({ projectId, branchId, configUpdate });

        const result = await applyConfigUpdate({
          getGithubToken,
          ref,
          completeConfig,
          onSandboxId,
          onStage,
          onProgress,
        });

        if (result.mode === "no-change") {
          await recordConfigAgentRunResult({
            projectId,
            branchId,
            runId,
            nowMs: Date.now(),
            outcome: { status: "no-change" },
          });
        } else {
          await setConfigAgentRunAwaitingReview({
            runId,
            change: result.change,
          });
        }
      } catch (error) {
        captureError("config-github-apply", error);
        await recordConfigAgentRunResult({
          projectId,
          branchId,
          runId,
          nowMs: Date.now(),
          outcome: { status: "error", error: "The config agent failed to apply the change." },
        }).catch((e) => captureError("config-github-apply-record-error", e));
      }
    });

    return { statusCode: 200, bodyType: "json", body: { status: "started", id: runId } };
  },
});
