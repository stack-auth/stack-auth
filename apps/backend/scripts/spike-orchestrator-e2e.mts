/**
 * End-to-end smoke test for the config-update repo agent against a REAL Vercel
 * Sandbox and a REAL GitHub repo. This is a scratch script, not a unit test.
 *
 * It runs the two-phase review flow: boot a sandbox (warm from the shared base
 * snapshot if STACK_CONFIG_AGENT_BASE_SNAPSHOT_ID is set, else cold-install the
 * agent SDK), clone the repo, agent edits the config, print the generated diff,
 * then explicitly COMMIT + PUSH to the branch.
 *
 * WARNING: this pushes a commit to the target repo. Point SPIKE_OWNER,
 * SPIKE_REPO, and SPIKE_BRANCH at a throwaway repo/branch.
 *
 * Run from apps/backend:
 *   pnpm dlx dotenv-cli -e .env.development.local -e .env.development -- \
 *     pnpm tsx scripts/spike-orchestrator-e2e.mts
 *
 * The GitHub token comes from $GITHUB_TOKEN, falling back to `gh auth token`.
 */
import { execFileSync } from "child_process";
import {
  applyConfigUpdate,
  commitConfigUpdate,
  type GithubRepoRef,
} from "../src/lib/config/repo-agent";

if (!process.env.SPIKE_OWNER || !process.env.SPIKE_REPO || !process.env.SPIKE_BRANCH) {
  console.error("SPIKE_OWNER, SPIKE_REPO, and SPIKE_BRANCH must all be set explicitly.\nThis script pushes commits to a real repo — refusing to fall back to defaults.");
  process.exit(1);
}
const REF: GithubRepoRef = {
  owner: process.env.SPIKE_OWNER,
  repo: process.env.SPIKE_REPO,
  branch: process.env.SPIKE_BRANCH,
};

// The COMPLETE config we want the repo's config file to reflect (the real flow
// computes this from the branch config override; here it's a small literal).
const COMPLETE_CONFIG = { auth: { allowSignUp: false } } as Record<string, unknown>;

function githubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return execFileSync("gh", ["auth", "token"], { encoding: "utf-8" }).trim();
}

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}
function log(msg: string) {
  console.log(`[${ts()}] ${msg}`);
}

async function main() {
  // Fresh token per boot (matches the production provider seam). Here it's the
  // same static token, fetched lazily each time the orchestrator boots a sandbox.
  const getGithubToken = async () => githubToken();
  log(`Target: ${REF.owner}/${REF.repo}@${REF.branch}`);

  log("applyConfigUpdate (boot + clone + agent edit)…");
  const t2 = performance.now();
  const result = await applyConfigUpdate({
    getGithubToken,
    ref: REF,
    completeConfig: COMPLETE_CONFIG,
  });
  log(`Done in ${((performance.now() - t2) / 1000).toFixed(0)}s`);
  log(`Result: ${JSON.stringify(result)}`);

  if (result.mode === "no-change") {
    log("⚠️  Agent produced no change (config already matched).");
  } else {
    log(`Review diff has ${result.diff.length} characters. Committing reviewed changes…`);
    const commit = await commitConfigUpdate({
      sandboxId: result.sandboxId,
      getGithubToken,
      ref: REF,
      commitMessage: "chore(hexclave): e2e smoke — set auth.allowSignUp=false",
    });
    log(`✅ Pushed: ${commit.commitUrl}`);
  }
}

main().catch((err) => {
  console.error("E2E FAILED:", err);
  process.exit(1);
});
