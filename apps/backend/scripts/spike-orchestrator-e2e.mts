/**
 * End-to-end smoke test for the config-update repo agent against a REAL Vercel
 * Sandbox and a REAL GitHub repo. This is a scratch script, not a unit test.
 *
 * It runs the full two-phase flow:
 *   1. prepareConfigRepoSnapshot  — clone + install + typecheck + snapshot
 *   2. applyConfigUpdateInSnapshot — warm-boot, agent edits the config, typecheck
 *                                    gate, COMMIT + PUSH to the base branch, re-snapshot
 *
 * WARNING: phase 2 pushes a commit to `main` of the target repo. Point it at a
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
  applyConfigUpdateInSnapshot,
  prepareConfigRepoSnapshot,
  type GithubRepoRef,
} from "../src/lib/config/repo-agent";

const REF: GithubRepoRef = {
  owner: process.env.SPIKE_OWNER ?? "hexclave",
  repo: process.env.SPIKE_REPO ?? "stackframe-website-2026",
  branch: process.env.SPIKE_BRANCH ?? "main",
};

// The dashboard-style update we want reflected in the repo's config.
const CONFIG_UPDATE = { "auth.allowSignUp": false } as any;

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
  const token = githubToken();
  log(`Target: ${REF.owner}/${REF.repo}@${REF.branch}`);

  log("Phase 1: prepareConfigRepoSnapshot (clone + install + typecheck + snapshot)…");
  const t1 = Date.now();
  const snapshot = await prepareConfigRepoSnapshot({ githubToken: token, ref: REF });
  log(`Phase 1 done in ${((Date.now() - t1) / 1000).toFixed(0)}s → snapshotId=${snapshot.snapshotId} baseSha=${snapshot.baseCommitSha.slice(0, 8)}`);

  log("Phase 2: applyConfigUpdateInSnapshot (agent edit + typecheck gate + push)…");
  const t2 = Date.now();
  const { result, snapshot: refreshed } = await applyConfigUpdateInSnapshot({
    githubToken: token,
    ref: REF,
    snapshot,
    configUpdate: CONFIG_UPDATE,
    commitMessage: "chore(hexclave): e2e smoke — set auth.allowSignUp=false",
  });
  log(`Phase 2 done in ${((Date.now() - t2) / 1000).toFixed(0)}s`);
  log(`Result: ${JSON.stringify(result)}`);
  log(`Refreshed snapshot: ${refreshed.snapshotId} (base ${refreshed.baseCommitSha.slice(0, 8)})`);

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
