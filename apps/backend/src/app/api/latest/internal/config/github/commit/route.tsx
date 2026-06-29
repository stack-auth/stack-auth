import {
  getConfigAgentRunChange,
  getGithubConfigSourceOrThrow,
  recordConfigAgentRunResult,
} from "@/lib/config";
import { CONFIG_REPO_COMMIT_CONFLICT_SAFE_ERROR, ConfigRepoCommitConflictError, commitConfigUpdate, type GithubRepoRef } from "@/lib/config/repo-agent";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { captureError } from "@hexclave/shared/dist/utils/errors";

// The commit is a handful of GitHub API calls (~seconds); the generous ceiling just
// absorbs slow GitHub responses for large change sets.
export const maxDuration = 120;

/**
 * Commits the agent's captured change set to GitHub after the user reviews the diff.
 * The change set was captured and persisted when the run entered `awaiting_review`
 * (the sandbox is long gone), so this replays it via the GitHub git data API — it
 * works no matter how long the review took. Returns immediately and does the work in
 * the background; the dashboard polls `agent_run` for the result.
 */
export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Commit config agent changes to GitHub",
    description: "Commits the agent's captured config change to the linked GitHub branch after user review.",
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
      github_access_token: yupString().defined(),
      commit_message: yupString().optional(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["committing", "not-awaiting-review"]).defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const projectId = req.auth.tenancy.project.id;
    const branchId = req.auth.tenancy.branchId;

    const source = await getGithubConfigSourceOrThrow({ projectId, branchId });

    const runId = req.body.run_id;
    const plan = await getConfigAgentRunChange({ projectId, branchId, runId });
    if (!plan || plan.status !== "awaiting_review") {
      return { statusCode: 200, bodyType: "json", body: { status: "not-awaiting-review" } };
    }

    if (!plan.change) {
      // Awaiting review but no captured change (should not happen for runs created by
      // the current apply flow). Mark it errored so the dashboard surfaces a retry.
      await recordConfigAgentRunResult({
        projectId,
        branchId,
        runId,
        nowMs: Date.now(),
        outcome: { status: "error", error: "Failed to commit and push the config changes." },
      });
      return { statusCode: 200, bodyType: "json", body: { status: "not-awaiting-review" } };
    }

    const change = plan.change;
    const githubToken = req.body.github_access_token;
    const commitMessage = req.body.commit_message?.trim() || "chore(hexclave): update config from dashboard";
    const ref: GithubRepoRef = { owner: source.owner, repo: source.repo, branch: source.branch };
    const getGithubToken = async () => githubToken;

    runAsynchronouslyAndWaitUntil(async () => {
      try {
        const result = await commitConfigUpdate({ getGithubToken, ref, commitMessage, change });
        await recordConfigAgentRunResult({
          projectId,
          branchId,
          runId,
          nowMs: Date.now(),
          outcome: { status: "success", commitUrl: result.commitUrl, newCommitHash: result.commitSha, committedRef: ref },
        });
      } catch (error) {
        if (!(error instanceof ConfigRepoCommitConflictError)) {
          captureError("config-github-commit", error);
        }
        await recordConfigAgentRunResult({
          projectId,
          branchId,
          runId,
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
