#!/usr/bin/env node
// Runs before `next dev`. Publishes the SpacetimeDB module to the local server
// if the spacetime CLI is installed. Otherwise, warns and continues so the
// dev server still starts (useful in CI and for contributors who haven't
// installed the CLI yet).

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
  console.warn(
    "\n[internal-tool] spacetime publish to local failed (is `spacetime start` running?). Skipping; starting Next anyway.\n",
  );
}

process.exit(0);
