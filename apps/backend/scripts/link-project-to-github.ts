/**
 * One-off: mark an EXISTING project's branch config as linked to a GitHub repo
 * (sets the `pushed-from-github` source) WITHOUT re-seeding the project. Useful
 * when the link-existing wizard's workflow can't reach a LOCAL backend (the
 * GitHub Actions runner can't POST to localhost, so the `config push` CI step
 * fails and the project never advances to "linked"). Run this to set the state.
 *
 *   cd apps/backend && LINK_PROJECT_ID=<uuid> pnpm run with-env:dev tsx scripts/link-project-to-github.ts
 *
 * Env (defaults shown):
 *   LINK_PROJECT_ID=<uuid>                                       (REQUIRED)
 *   LINK_OWNER=mantrakp04
 *   LINK_REPO=config-test
 *   LINK_BRANCH=main
 *   LINK_CONFIG_PATH=hexclave.config.ts
 *   LINK_WORKFLOW_PATH=.github/workflows/hexclave-config-sync.yml
 *   LINK_COMMIT=<head sha>                                       (informational; the agent pulls latest)
 */
import { setBranchConfigOverrideSource } from "@/lib/config";
import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";

async function main() {
  const projectId = getEnvVariable("LINK_PROJECT_ID", "");
  if (!projectId) throw new Error("LINK_PROJECT_ID is required (the project to mark as linked).");
  const owner = getEnvVariable("LINK_OWNER", "mantrakp04");
  const repo = getEnvVariable("LINK_REPO", "config-test");
  const branch = getEnvVariable("LINK_BRANCH", "main");
  const configFilePath = getEnvVariable("LINK_CONFIG_PATH", "hexclave.config.ts");
  const workflowPath = getEnvVariable("LINK_WORKFLOW_PATH", ".github/workflows/hexclave-config-sync.yml");
  const commitHash = getEnvVariable("LINK_COMMIT", "") || "0".repeat(40);

  await setBranchConfigOverrideSource({
    projectId,
    branchId: DEFAULT_BRANCH_ID,
    source: {
      type: "pushed-from-github",
      owner,
      repo,
      branch,
      commit_hash: commitHash,
      config_file_path: configFilePath,
      workflow_path: workflowPath,
    },
  });

  console.log(`✅ Linked ${projectId} -> ${owner}/${repo}@${branch}`);
  console.log(`   config: ${configFilePath} | workflow: ${workflowPath} | commit: ${commitHash.slice(0, 9)}`);
}

// eslint-disable-next-line no-restricted-syntax
main().then(() => process.exit(0)).catch((error: unknown) => {
  console.error("\nlink-project-to-github failed:", error);
  process.exit(1);
});
