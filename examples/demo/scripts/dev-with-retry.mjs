#!/usr/bin/env node

// Resilient wrapper for the demo dev command.
//
// The demo runs through the CLI because it needs development-environment
// credentials, but it must not call `pnpm -w run cli`: that route invokes Turbo
// builds, and several package builds start by removing dist/, racing with the
// package dev watchers that the root dev server is already running.
//
// Instead, run the CLI from TypeScript source and ask it to launch the dashboard
// through the dashboard package's RDE production command. The CLI still owns the
// development-environment env vars, so this stays close to the packaged path.

import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const scriptDir = import.meta.dirname;
const demoRoot = resolve(scriptDir, "..");
const repoRoot = resolve(demoRoot, "../..");

const LOG_PREFIX = "[Hexclave dev-retry] ";
const RETRY_DEBOUNCE_MS = 2_000;
const RETRY_TIMEOUT_MS = 5_000;
const portPrefix = process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81";

let cliChild;
let shutdownTimer;

function log(message) {
  console.error(`${LOG_PREFIX}${message}`);
}

function spawnFromRepo(command, args, options = {}) {
  return spawn(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
    ...options,
  });
}

function runCliDev() {
  return new Promise((resolvePromise, reject) => {
    cliChild = spawnFromRepo("pnpm", [
      "exec", "tsx", "packages/cli/src/index.ts",
      "dev",
      "--no-auto-update",
      "--config-file=./hexclave.config.ts",
      "--",
      "pnpm", "--dir", "examples/demo", "run", "dev:inner",
    ], {
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        HEXCLAVE_CLI_DEV_DASHBOARD_COMMAND: "pnpm --dir apps/dashboard run dev:rde-production",
        STACK_API_URL: `http://localhost:${portPrefix}02`,
        STACK_DASHBOARD_URL: `http://localhost:${portPrefix}01`,
        STACK_CLI_PUBLISHABLE_CLIENT_KEY: "this-publishable-client-key-is-for-local-development-only",
        STACK_CLI_NO_AUTO_UPDATE: "1",
      },
    });

    cliChild.on("close", (code, signal) => {
      cliChild = undefined;
      resolvePromise({ code: code ?? 1, signalled: signal != null });
    });
    cliChild.on("error", (err) => {
      cliChild = undefined;
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

    // Dashboard startup can complete without a source-file change after the CLI
    // has already failed its first health check, so always keep a timed retry.
    setTimeout(done, RETRY_TIMEOUT_MS);
  });
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const { code, signalled } = await runCliDev();

    if (signalled || code === 0) {
      stopChildren("SIGTERM");
      process.exit(code);
    }

    log(`Dev command exited with code ${code}. Watching for file changes before retrying...`);
    await waitForFileChanges();
    log(`Retrying in ${RETRY_DEBOUNCE_MS / 1000}s...`);
    await sleep(RETRY_DEBOUNCE_MS);
  }
}

function stopChildren(signal) {
  if (cliChild != null && !cliChild.killed) {
    try {
      if (cliChild.pid != null && process.platform !== "win32") {
        process.kill(-cliChild.pid, signal);
      } else {
        cliChild.kill(signal);
      }
    } catch {
      // best-effort
    }
  }
}

process.on("SIGINT", () => {
  stopChildren("SIGINT");
  shutdownTimer ??= setTimeout(() => process.exit(130), 5_000);
  shutdownTimer.unref();
});
process.on("SIGTERM", () => {
  stopChildren("SIGTERM");
  shutdownTimer ??= setTimeout(() => process.exit(143), 5_000);
  shutdownTimer.unref();
});

main().catch((err) => {
  console.error(err);
  stopChildren("SIGTERM");
  process.exit(1);
});
