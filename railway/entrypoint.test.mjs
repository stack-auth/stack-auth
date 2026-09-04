import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const ENTRYPOINT_PATH = fileURLToPath(new URL("./entrypoint.sh", import.meta.url));

let workDir;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "hexclave-railway-entrypoint-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/**
 * Runs the entrypoint against stub replacements for everything it starts, so the
 * env-derivation rules can be checked without a Hexclave image. The stub upstream
 * entrypoint prints the variables it was handed and exits, which the entrypoint's
 * supervisor treats as a child exiting — that is the intended way to end the run.
 */
async function runEntrypoint(env) {
  const upstream = path.join(workDir, "entrypoint.sh");
  await writeFile(
    upstream,
    [
      "#!/bin/bash",
      // Emit exactly the variables under test, so assertions do not depend on the
      // rest of the environment leaking through.
      'for name in HEXCLAVE_DATABASE_CONNECTION_STRING STACK_DATABASE_CONNECTION_STRING NEXT_PUBLIC_HEXCLAVE_API_URL NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL HEXCLAVE_TRUSTED_PROXY; do',
      '  echo "UPSTREAM_ENV ${name}=${!name:-}"',
      "done",
      'echo "UPSTREAM_CWD $PWD"',
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );

  // Idle stand-ins for the proxy and cron runner. Tests that enable either one
  // care about the entrypoint's decision to start it, not about the real process,
  // and a stub that stays alive keeps the supervisor waiting on the upstream stub
  // rather than racing a stub that exited first.
  const idleStub = "setInterval(() => {}, 1 << 30);\n";
  await writeFile(path.join(workDir, "proxy.mjs"), idleStub);
  await writeFile(path.join(workDir, "cron.mjs"), idleStub);

  const child = spawn("bash", [ENTRYPOINT_PATH], {
    env: {
      PATH: process.env.PATH,
      HEXCLAVE_RAILWAY_UPSTREAM_ENTRYPOINT: upstream,
      HEXCLAVE_RAILWAY_APP_DIR: workDir,
      HEXCLAVE_RAILWAY_DIR: workDir,
      // The proxy and cron runner are exercised by their own tests; disabling them
      // keeps this focused on configuration derivation and supervision.
      HEXCLAVE_RAILWAY_DISABLE_PROXY: "true",
      HEXCLAVE_RAILWAY_DISABLE_CRON: "true",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve) => child.on("exit", resolve));

  const upstreamEnv = new Map(
    stdout
      .split("\n")
      .filter((line) => line.startsWith("UPSTREAM_ENV "))
      .map((line) => {
        const assignment = line.slice("UPSTREAM_ENV ".length);
        const separator = assignment.indexOf("=");
        return [assignment.slice(0, separator), assignment.slice(separator + 1)];
      }),
  );
  return { exitCode, stdout, stderr, upstreamEnv };
}

describe("environment derivation", () => {
  test("maps Railway's DATABASE_URL onto the Hexclave connection string", async () => {
    // Railway's Postgres publishes DATABASE_URL. Deriving it here is what lets a
    // service wired to a Railway database carry no database variable of its own.
    const { upstreamEnv } = await runEntrypoint({ DATABASE_URL: "postgres://u:p@db.internal:5432/railway" });
    expect(upstreamEnv.get("HEXCLAVE_DATABASE_CONNECTION_STRING")).toBe("postgres://u:p@db.internal:5432/railway");
  });

  test("an explicit connection string wins over DATABASE_URL", async () => {
    const { upstreamEnv } = await runEntrypoint({
      DATABASE_URL: "postgres://railway/managed",
      HEXCLAVE_DATABASE_CONNECTION_STRING: "postgres://operator/explicit",
    });
    expect(upstreamEnv.get("HEXCLAVE_DATABASE_CONNECTION_STRING")).toBe("postgres://operator/explicit");
  });

  test("does not derive over the legacy STACK_-prefixed spelling", async () => {
    // The application refuses to start when the HEXCLAVE_ and STACK_ spellings of
    // the same setting disagree, so deriving on top of an operator's STACK_ value
    // would turn a working deployment into a hard startup failure.
    const { upstreamEnv } = await runEntrypoint({
      DATABASE_URL: "postgres://railway/managed",
      STACK_DATABASE_CONNECTION_STRING: "postgres://operator/legacy",
    });
    expect(upstreamEnv.get("HEXCLAVE_DATABASE_CONNECTION_STRING")).toBe("");
    expect(upstreamEnv.get("STACK_DATABASE_CONNECTION_STRING")).toBe("postgres://operator/legacy");
  });

  test("derives both public URLs from the Railway domain", async () => {
    // Both point at one origin because the proxy serves the API and the dashboard
    // from a single port.
    const { upstreamEnv } = await runEntrypoint({
      RAILWAY_PUBLIC_DOMAIN: "hexclave-production.up.railway.app",
      HEXCLAVE_RAILWAY_DISABLE_PROXY: "false",
    });
    expect(upstreamEnv.get("NEXT_PUBLIC_HEXCLAVE_API_URL")).toBe("https://hexclave-production.up.railway.app");
    expect(upstreamEnv.get("NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL")).toBe("https://hexclave-production.up.railway.app");
  });

  test("an explicit custom domain wins over the Railway domain", async () => {
    const { upstreamEnv } = await runEntrypoint({
      RAILWAY_PUBLIC_DOMAIN: "hexclave-production.up.railway.app",
      HEXCLAVE_RAILWAY_DISABLE_PROXY: "false",
      NEXT_PUBLIC_HEXCLAVE_API_URL: "https://auth.example.com",
      NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL: "https://auth.example.com",
    });
    expect(upstreamEnv.get("NEXT_PUBLIC_HEXCLAVE_API_URL")).toBe("https://auth.example.com");
    expect(upstreamEnv.get("NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL")).toBe("https://auth.example.com");
  });

  test("does not derive public URLs from the Railway domain when the proxy is disabled", async () => {
    // Without the proxy the API and dashboard are on separate ports and therefore
    // separate domains, so one shared origin would be wrong for at least one of them.
    const { upstreamEnv } = await runEntrypoint({
      RAILWAY_PUBLIC_DOMAIN: "hexclave-production.up.railway.app",
      HEXCLAVE_RAILWAY_DISABLE_PROXY: "true",
    });
    expect(upstreamEnv.get("NEXT_PUBLIC_HEXCLAVE_API_URL")).toBe("");
  });

  test("defaults the trusted proxy to generic for the Railway edge", async () => {
    // The backend refuses to start with an HTTPS public URL unless it knows a proxy
    // terminates TLS in front of it.
    const { upstreamEnv } = await runEntrypoint({});
    expect(upstreamEnv.get("HEXCLAVE_TRUSTED_PROXY")).toBe("generic");
  });

  test("an explicit trusted proxy setting is left alone", async () => {
    const { upstreamEnv } = await runEntrypoint({ HEXCLAVE_TRUSTED_PROXY: "cloudflare" });
    expect(upstreamEnv.get("HEXCLAVE_TRUSTED_PROXY")).toBe("cloudflare");
  });
});

describe("supervision", () => {
  test("runs the upstream entrypoint from the app directory", async () => {
    // Upstream cd's into apps/backend by relative path, so the wrong working
    // directory turns into a confusing migration failure.
    const { stdout } = await runEntrypoint({});
    expect(stdout).toContain(`UPSTREAM_CWD ${workDir}`);
  });

  test("propagates the upstream entrypoint's exit code", async () => {
    const { exitCode } = await runEntrypoint({});
    expect(exitCode).toBe(0);
  });

  test("warns loudly when CRON_SECRET is missing rather than skipping cron silently", async () => {
    const { stderr } = await runEntrypoint({ HEXCLAVE_RAILWAY_DISABLE_CRON: "false" });
    expect(stderr).toContain("CRON_SECRET is unset");
  });

  test("fails fast when the base image has no upstream entrypoint", async () => {
    const child = spawn("bash", [ENTRYPOINT_PATH], {
      env: {
        PATH: process.env.PATH,
        HEXCLAVE_RAILWAY_UPSTREAM_ENTRYPOINT: path.join(workDir, "does-not-exist.sh"),
        HEXCLAVE_RAILWAY_DISABLE_PROXY: "true",
        HEXCLAVE_RAILWAY_DISABLE_CRON: "true",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const exitCode = await new Promise((resolve) => child.on("exit", resolve));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("expected the base image's entrypoint");
  });
});
