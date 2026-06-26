/**
 * One-off: builds the shared config-agent base snapshot (node24 + Claude Agent SDK
 * + git bot identity; no repo, no token) that every config write warm-boots from,
 * in place of a custom Docker image. Re-run when AGENT_SDK_VERSION in repo-agent.ts
 * changes; old snapshots can be deleted from the Vercel dashboard.
 *
 *   cd apps/backend && pnpm run with-env:dev tsx scripts/config-agent/build-image.ts
 *
 * Then set the printed id as HEXCLAVE_CONFIG_AGENT_BASE_SNAPSHOT_ID. Needs
 * HEXCLAVE_VERCEL_SANDBOX_TOKEN (+ team/project ids).
 */
import { buildConfigAgentBaseSnapshot } from "@/lib/config/repo-agent";

async function main() {
  const t0 = Date.now();
  const { snapshotId } = await buildConfigAgentBaseSnapshot((m) => console.log(`  ${m}`));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n✅ Base snapshot built in ${secs}s.\n`);
  console.log("Set this env var so config writes warm-boot from it:\n");
  console.log(`  HEXCLAVE_CONFIG_AGENT_BASE_SNAPSHOT_ID=${snapshotId}\n`);
}

// eslint-disable-next-line no-restricted-syntax
main().then(() => process.exit(0)).catch((error: unknown) => {
  console.error("Failed to build the config-agent base snapshot:", error);
  process.exit(1);
});
