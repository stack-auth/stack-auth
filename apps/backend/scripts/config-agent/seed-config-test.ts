/**
 * Seeds a local dashboard project whose branch config is LINKED to a real
 * GitHub repo (default: mantrakp04/config-test), so you can exercise the
 * dashboard -> GitHub config-agent flow end to end against a real repository.
 *
 * What it does:
 *   1. Resolves an owner team (so the project shows up in a dashboard user's
 *      project list) — the first team in the internal tenancy, or
 *      STACK_SEED_OWNER_TEAM_ID if set.
 *   2. Creates a dummy project via the same path the "create preview project"
 *      button uses (seedDummyProject), with skipGithubConfigSource so we set
 *      the source ourselves.
 *   3. Points its branch config `source` at the linked GitHub repo as
 *      `pushed-from-github`, which is what makes the dashboard route saves
 *      through the config agent (apply/route.tsx) instead of editing cloud
 *      config directly.
 *
 * Run it (clickhouse + postgres must be up, i.e. the local stack running):
 *   pnpm --filter @hexclave/backend run with-env:dev tsx scripts/config-agent/seed-config-test.ts
 *
 * Override the target repo / config file via env (defaults shown):
 *   STACK_CONFIG_TEST_OWNER=mantrakp04
 *   STACK_CONFIG_TEST_REPO=config-test
 *   STACK_CONFIG_TEST_BRANCH=main
 *   STACK_CONFIG_TEST_CONFIG_PATH=hexclave.config.ts
 *   STACK_CONFIG_TEST_WORKFLOW_PATH=.github/workflows/hexclave-config-sync.yml
 *   STACK_CONFIG_TEST_COMMIT=<head sha>            (informational; the agent pulls latest anyway)
 *   STACK_CONFIG_TEST_PROJECT_ID=<uuid>            (reuse/refresh an existing seeded project)
 *   STACK_SEED_OWNER_TEAM_ID=<uuid>                (override the auto-resolved owner team)
 */
import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { setBranchConfigOverrideSource } from "@/lib/config";
import { seedDummyProject } from "@/lib/seed-dummy-data";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";

async function resolveOwnerTeamId(): Promise<string> {
  const fromEnv = getEnvVariable("STACK_SEED_OWNER_TEAM_ID", "");
  if (fromEnv) return fromEnv;

  const internalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
  const internalPrisma = await getPrismaClientForTenancy(internalTenancy);
  const membership = await internalPrisma.teamMember.findFirst({
    where: { tenancyId: internalTenancy.id },
    select: { teamId: true },
  });
  if (!membership) {
    throw new Error(
      "No team found in the internal project. Sign into the local dashboard once (a team is auto-created on sign-up), " +
      "or pass STACK_SEED_OWNER_TEAM_ID=<uuid>.",
    );
  }
  return membership.teamId;
}

async function main() {
  const owner = getEnvVariable("STACK_CONFIG_TEST_OWNER", "mantrakp04");
  const repo = getEnvVariable("STACK_CONFIG_TEST_REPO", "config-test");
  const branch = getEnvVariable("STACK_CONFIG_TEST_BRANCH", "main");
  const configFilePath = getEnvVariable("STACK_CONFIG_TEST_CONFIG_PATH", "hexclave.config.ts");
  const workflowPath = getEnvVariable("STACK_CONFIG_TEST_WORKFLOW_PATH", ".github/workflows/hexclave-config-sync.yml");
  const commitHash = getEnvVariable("STACK_CONFIG_TEST_COMMIT", "") || "0".repeat(40);
  const projectIdEnv = getEnvVariable("STACK_CONFIG_TEST_PROJECT_ID", "");

  const ownerTeamId = await resolveOwnerTeamId();
  console.log(`Seeding config-test project owned by team ${ownerTeamId}…`);

  const projectId = await seedDummyProject({
    ...(projectIdEnv ? { projectId: projectIdEnv } : {}),
    ownerTeamId,
    oauthProviderIds: ["github"],
    excludeAlphaApps: true,
    // We set the GitHub source ourselves below (pointing at the real repo).
    skipGithubConfigSource: true,
    clickhouseClient: getClickhouseAdminClient(),
  });

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

  console.log("\n✅ Seeded a project linked to GitHub for the config-agent flow:");
  console.log(`   project id : ${projectId}`);
  console.log(`   linked repo: https://github.com/${owner}/${repo} (@${branch}, ${configFilePath})`);
  console.log("\nOpen it in the local dashboard, change a setting, and Save — the config");
  console.log(`agent will commit the change to ${owner}/${repo}@${branch}.`);
}

// eslint-disable-next-line no-restricted-syntax
main().then(() => process.exit(0)).catch((error: unknown) => {
  console.error("\nseed-config-test failed:", error);
  process.exit(1);
});
