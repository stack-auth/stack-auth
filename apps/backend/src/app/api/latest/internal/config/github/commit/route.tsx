import {
  getConfigAgentRun,
  getGithubConfigSourceOrThrow,
  recordConfigAgentRunResult,
} from "@/lib/config";
import { CONFIG_REPO_COMMIT_CONFLICT_SAFE_ERROR, ConfigRepoCommitConflictError, commitConfigUpdate, type GithubRepoRef, stopConfigAgentSandbox } from "@/lib/config/repo-agent";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { captureError } from "@hexclave/shared/dist/utils/errors";

// The commit+push itself is fast (~10 s) but we give generous room for sandbox
// reconnect latency and slow GitHub API responses.
export const maxDuration = 120;

/**
 * Commits and pushes the agent's already-applied changes from an `awaiting_review`
 * sandbox. The user explicitly triggered this after reviewing the diff in the
 * dashboard. Returns immediately and does the work in the background.
 */
export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Commit config agent changes to GitHub",
    description: "Commits and pushes the agent's already-applied config changes after user review.",
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
      commit_message: yupString().optional(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["committing", "not-awaiting-review", "sandbox-expired"]).defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const projectId = req.auth.tenancy.project.id;
    const branchId = req.auth.tenancy.branchId;

    const source = await getGithubConfigSourceOrThrow({ projectId, branchId });

    const run = await getConfigAgentRun({ projectId, branchId });
    if (!run || run.status !== "awaiting_review") {
      return { statusCode: 200, bodyType: "json", body: { status: "not-awaiting-review" } };
    }
    const runStartedAt = run.started_at;

    const sandboxId = run.sandbox_id;
    if (!sandboxId) {
      // Sandbox id was never recorded — can't commit. Treat as an error and clean up.
      await recordConfigAgentRunResult({
        projectId,
        branchId,
        runStartedAt,
        nowMs: Date.now(),
        outcome: { status: "error", error: "Sandbox session expired. Please retry the update." },
      });
      return { statusCode: 200, bodyType: "json", body: { status: "sandbox-expired" } };
    }

    const githubToken = req.body.github_access_token;
    const commitMessage = req.body.commit_message?.trim() || "chore(hexclave): update config from dashboard";
    const ref: GithubRepoRef = { owner: source.owner, repo: source.repo, branch: source.branch };
    const getGithubToken = async () => githubToken;

    runAsynchronouslyAndWaitUntil(async () => {
      try {
        const result = await commitConfigUpdate({ sandboxId, getGithubToken, ref, commitMessage });
        await recordConfigAgentRunResult({
          projectId,
          branchId,
          runStartedAt,
          nowMs: Date.now(),
          outcome: { status: "success", commitUrl: result.commitUrl, newCommitHash: result.commitSha },
        });
      } catch (error) {
        if (!(error instanceof ConfigRepoCommitConflictError)) {
          captureError("config-github-commit", error);
        }
        await stopConfigAgentSandbox(sandboxId);
        await recordConfigAgentRunResult({
          projectId,
          branchId,
          runStartedAt,
          nowMs: Date.now(),
          outcome: {
            status: "error",
            error: error instanceof ConfigRepoCommitConflictError ? CONFIG_REPO_COMMIT_CONFLICT_SAFE_ERROR : "Failed to commit and push the config changes.",
          },
        }).catch((e) => captureError("config-github-commit-record-error", e));
      }
    });

    return { statusCode: 200, bodyType: "json", body: { status: "committing" } };
  },
});
