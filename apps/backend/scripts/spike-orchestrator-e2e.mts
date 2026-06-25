/**
 * End-to-end smoke test for the config-update repo agent against a REAL Vercel
 * Sandbox and a REAL GitHub repo. This is a scratch script, not a unit test.
 *
 * It runs the single-phase apply flow: boot a sandbox (warm from the shared base
 * snapshot if STACK_CONFIG_AGENT_BASE_SNAPSHOT_ID is set, else cold-install the
 * agent SDK), clone the repo, agent edits the config, COMMIT + PUSH to the branch.
 *
 * WARNING: this pushes a commit to `main` of the target repo. Point it at a
 * throwaway repo (default: hexclave/stackframe-website-2026).
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
  type GithubRepoRef,
} from "../src/lib/config/repo-agent";

const REF: GithubRepoRef = {
  owner: process.env.SPIKE_OWNER ?? "hexclave",
  repo: process.env.SPIKE_REPO ?? "stackframe-website-2026",
  branch: process.env.SPIKE_BRANCH ?? "main",
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

  log("applyConfigUpdate (boot + clone + agent edit + push)…");
  const t2 = Date.now();
  const result = await applyConfigUpdate({
    getGithubToken,
    ref: REF,
    completeConfig: COMPLETE_CONFIG,
    commitMessage: "chore(hexclave): e2e smoke — set auth.allowSignUp=false",
  });
  log(`Done in ${((Date.now() - t2) / 1000).toFixed(0)}s`);
  log(`Result: ${JSON.stringify(result)}`);

  if (result.mode === "commit-to-branch") {
    log(`✅ Pushed: ${result.commitUrl}`);
  } else {
    log("⚠️  Agent produced no change (config already matched).");
  }
}

main().catch((err) => {
  console.error("E2E FAILED:", err);
  process.exit(1);
});
