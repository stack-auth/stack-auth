import {
  getBranchConfigOverrideSource,
  recordConfigAgentRunResult,
  tryStartConfigAgentRun,
} from "@/lib/config";
import { applyConfigUpdateInSnapshot, prepareConfigRepoSnapshot, type ConfigRepoSnapshot, type GithubRepoRef } from "@/lib/config/repo-agent";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import type { EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

// The whole flow (cold snapshot prep + agent edit + typecheck + push) can take a
// few minutes; the response returns immediately and the work continues via
// waitUntil. Give the serverless invocation room to finish the background work.
export const maxDuration = 800;

// A `running` marker older than this is treated as abandoned (server died mid-run).
const RUN_STALE_MS = 15 * 60_000;

/**
 * Kicks off an AI-agent config write against the linked GitHub repo. Reads use
 * jiti; writes go through the agent in a Vercel Sandbox (see
 * `config-update-repo-agent`). The dashboard polls `/internal/config/source`
 * (`agent_run`) for progress.
 *
 * The GitHub token is the dashboard user's own OAuth token, passed in by the
 * client and used transiently for the sandbox's git pull/push — it is never
 * persisted and never placed in the agent's environment.
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
      commit_message: yupString().optional(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["started", "already-running"]).defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const projectId = req.auth.tenancy.project.id;
    const branchId = req.auth.tenancy.branchId;

    const source = await getBranchConfigOverrideSource({ projectId, branchId });
    if (source.type !== "pushed-from-github") {
      throw new StatusError(StatusError.BadRequest, "This project's configuration is not linked to a GitHub repository.");
    }

    let configUpdate: EnvironmentConfigOverrideOverride;
    try {
      configUpdate = JSON.parse(req.body.config_update_string);
    } catch {
      throw new StatusError(StatusError.BadRequest, "config_update_string is not valid JSON.");
    }

    const githubToken = req.body.github_access_token;
    const commitMessage = req.body.commit_message;
    const ref: GithubRepoRef = { owner: source.owner, repo: source.repo, branch: source.branch };

    const nowMs = Date.now();
    const { started } = await tryStartConfigAgentRun({ projectId, branchId, staleMs: RUN_STALE_MS, nowMs });
    if (!started) {
      return { statusCode: 200, bodyType: "json", body: { status: "already-running" } };
    }

    runAsynchronouslyAndWaitUntil(async () => {
      try {
        // Warm-boot from the cached snapshot if we have one; otherwise prepare it now.
        let snapshot: ConfigRepoSnapshot;
        if (source.latest_snapshot) {
          snapshot = { snapshotId: source.latest_snapshot.snapshot_id, baseCommitSha: source.latest_snapshot.base_commit_sha };
        } else {
          snapshot = await prepareConfigRepoSnapshot({ githubToken, ref });
        }

        const { result, snapshot: refreshed } = await applyConfigUpdateInSnapshot({
          githubToken,
          ref,
          snapshot,
          configUpdate,
          commitMessage,
        });

        await recordConfigAgentRunResult({
          projectId,
          branchId,
          nowMs: Date.now(),
          outcome: result.mode === "commit-to-branch"
            ? { status: "success", commitUrl: result.commitUrl, snapshot: refreshed, newCommitHash: refreshed.baseCommitSha }
            : { status: "no-change", snapshot: refreshed },
        });
      } catch (error) {
        captureError("config-github-apply", error);
        await recordConfigAgentRunResult({
          projectId,
          branchId,
          nowMs: Date.now(),
          outcome: { status: "error", error: error instanceof Error ? error.message : "The config agent failed to apply the change." },
        }).catch((e) => captureError("config-github-apply-record-error", e));
      }
    });

    return { statusCode: 200, bodyType: "json", body: { status: "started" } };
  },
});
