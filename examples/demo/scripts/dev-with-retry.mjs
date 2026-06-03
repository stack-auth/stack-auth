#!/usr/bin/env node

// Resilient wrapper for the demo dev command.
//
// The demo dev flow runs `pnpm -w run cli`, which internally builds the CLI
// package (and its dependency, dashboard build:rde-standalone). If that build
// fails, this process would normally exit, and because the root dev script uses
// `concurrently -k`, the entire dev server would die.
//
// This wrapper catches non-zero exits and watches for file changes in the
// dashboard and packages directories before retrying, so a transient build
// failure doesn't tear down the whole dev server.

import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const scriptDir = import.meta.dirname;
const demoRoot = resolve(scriptDir, "..");
const repoRoot = resolve(demoRoot, "../..");

const LOG_PREFIX = "[Hexclave dev-retry] ";
const RETRY_DEBOUNCE_MS = 2_000;

function log(message) {
  console.error(`${LOG_PREFIX}${message}`);
}

function runCliDev() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", [
      "-w", "run", "cli", "--",
      "dev",
      "--config-file=./hexclave.config.ts",
      "--",
      "pnpm", "--dir", "examples/demo", "run", "dev:inner",
    ], {
      stdio: "inherit",
      env: process.env,
    });

    let signalled = false;

    const forwardSigint = () => { signalled = true; child.kill("SIGINT"); };
    const forwardSigterm = () => { signalled = true; child.kill("SIGTERM"); };
    process.on("SIGINT", forwardSigint);
    process.on("SIGTERM", forwardSigterm);

    child.on("close", (code) => {
      process.off("SIGINT", forwardSigint);
      process.off("SIGTERM", forwardSigterm);
      resolvePromise({ code: code ?? 1, signalled });
    });
    child.on("error", (err) => {
      process.off("SIGINT", forwardSigint);
      process.off("SIGTERM", forwardSigterm);
      reject(err);
    });
  });
}

function waitForFileChanges() {
  return new Promise((resolvePromise) => {
    const watchDirs = [
      join(repoRoot, "apps", "dashboard"),
      join(repoRoot, "packages"),
    ];
    const watchers = [];
    let resolved = false;

    const done = () => {
      if (resolved) return;
      resolved = true;
      for (const w of watchers) {
        try { w.close(); } catch { /* ignore */ }
      }
      resolvePromise();
    };

    for (const dir of watchDirs) {
      try {
        const w = watch(dir, { recursive: true }, done);
        w.on("error", () => { /* ignore watch errors */ });
        watchers.push(w);
      } catch {
        // directory might not exist yet
      }
    }

    // Fallback: if no watchers could be set up, resolve after a timeout so we
    // don't block forever.
    if (watchers.length === 0) {
      log("Could not set up file watchers. Will retry after a delay.");
      setTimeout(done, 10_000);
    }
  });
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const { code, signalled } = await runCliDev();

    if (signalled || code === 0) {
      process.exit(code);
    }

    log(`Dev command exited with code ${code}. Watching for file changes before retrying...`);
    await waitForFileChanges();
    log(`Change detected. Retrying in ${RETRY_DEBOUNCE_MS / 1000}s...`);
    await sleep(RETRY_DEBOUNCE_MS);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
