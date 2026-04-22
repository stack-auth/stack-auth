#!/usr/bin/env node
// Runs before `next dev`. Publishes the SpacetimeDB module to the local server
// if the spacetime CLI is installed and the local server accepts the publish.
// Otherwise, warns and continues so the dev server still starts (useful in CI,
// for contributors who haven't installed the CLI yet, and when no local
// SpacetimeDB server is running — the internal-tool Next.js app itself doesn't
// need Spacetime to boot).

import { spawnSync } from "node:child_process";

const which = spawnSync(process.platform === "win32" ? "where" : "which", ["spacetime"], {
  stdio: "ignore",
});

if (which.status !== 0) {
  console.warn("\n[internal-tool] spacetime CLI not found, skipping publish.");
  console.warn("[internal-tool] To install it: curl -sSf https://install.spacetimedb.com | sh\n");
  process.exit(0);
}

const publish = spawnSync("pnpm", ["spacetime:publish:local"], {
  stdio: "inherit",
});

if (publish.status !== 0) {
  console.warn("\n[internal-tool] spacetime publish failed (exit code " + (publish.status ?? "unknown") + "). Continuing with dev server startup.");
  console.warn("[internal-tool] If you need Spacetime locally, make sure a SpacetimeDB server is running on http://127.0.0.1:3000 (see: spacetime start).\n");
}

process.exit(0);
