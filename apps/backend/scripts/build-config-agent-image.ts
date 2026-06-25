/**
 * One-off: build the shared config-agent "image" — a Vercel Sandbox base snapshot
 * with node + the Claude Agent SDK + the git bot identity baked in (NO repo, NO
 * token). This stands in for a custom Docker image (Vercel Sandbox can't boot from
 * one). Every dashboard config write warm-boots from it and then clones the repo
 * fresh, so you only pay the SDK install once — here.
 *
 *   cd apps/backend && pnpm run with-env:dev tsx scripts/build-config-agent-image.ts
 *
 * Then set the printed id so config writes warm-boot from it (either spelling works;
 * the env shim maps STACK_* <-> HEXCLAVE_*):
 *
 *   HEXCLAVE_CONFIG_AGENT_BASE_SNAPSHOT_ID=<printed id>
 *
 * Needs HEXCLAVE_VERCEL_SANDBOX_TOKEN (+ team/project ids) configured. Re-run this
 * whenever AGENT_SDK_VERSION in repo-agent.tsx changes; old base snapshots can be
 * deleted from the Vercel dashboard.
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
