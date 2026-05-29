import { spawn } from "child_process";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readCliUpdateCheckCache, writeCliUpdateCheckCache } from "./dev-env-state.js";

// Set on the process we re-exec via npx so the child doesn't try to update
// itself again (it already *is* the latest), preventing an infinite loop.
export const SKIP_AUTO_UPDATE_ENV = "STACK_CLI_SKIP_AUTO_UPDATE";
// User-facing opt-out. Set to a truthy value to never auto-update.
export const DISABLE_AUTO_UPDATE_ENV = "STACK_CLI_NO_AUTO_UPDATE";

const DEFAULT_UPDATE_CHECK_TIMEOUT_MS = 1_500;
const DEFAULT_UPDATE_CHECK_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const LOG_PREFIX = "[Hexclave] ";

function logUpdate(message: string): void {
  console.warn(`${LOG_PREFIX}${message}`);
}

// Treats absent / "" / "0" / "false" as disabled; anything else as enabled.
export function isEnvFlagEnabled(value: string | undefined): boolean {
  if (value == null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

// Auto-update is skipped when we're the re-exec'd child, when the user opted
// out, or in CI (where re-running an arbitrary newer version would be
// non-deterministic).
export function shouldAutoUpdate(env: NodeJS.ProcessEnv): boolean {
  if (isEnvFlagEnabled(env[SKIP_AUTO_UPDATE_ENV])) return false;
  if (isEnvFlagEnabled(env[DISABLE_AUTO_UPDATE_ENV])) return false;
  if (isEnvFlagEnabled(env.CI)) return false;
  return true;
}

type ParsedVersion = {
  core: [number, number, number],
  hasPrerelease: boolean,
};

function parseVersionCore(version: string): ParsedVersion | null {
  const trimmed = version.trim();
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(trimmed);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    // A `-` immediately after the core marks a semver prerelease (e.g.
    // 2.8.109-beta.1). `.test()` returns a plain boolean, sidestepping the
    // optional-capture-group typing.
    hasPrerelease: /^v?\d+\.\d+\.\d+-/.test(trimmed),
  };
}

// Returns true only when `candidate` is strictly newer than `current`. Unknown
// or unparseable versions return false so we never re-exec into a version we
// can't reason about (and never downgrade).
export function isVersionNewer(candidate: string, current: string): boolean {
  const a = parseVersionCore(candidate);
  const b = parseVersionCore(current);
  if (a == null || b == null) return false;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) {
      return a.core[i] > b.core[i];
    }
  }
  // Same x.y.z: a final release outranks a prerelease of the same core.
  return !a.hasPrerelease && b.hasPrerelease;
}

export type OwnPackage = {
  name: string,
  version: string,
  binName: string,
};

function resolveBinName(bin: unknown, packageName: string): string {
  if (bin != null && typeof bin === "object") {
    const keys = Object.keys(bin as Record<string, unknown>);
    // Prefer the `stack` bin: it exists today and is kept as an alias after the
    // hexclave rename, so it's the one bin name guaranteed across versions.
    if (keys.includes("stack")) return "stack";
    if (keys.length > 0) return keys[0];
  }
  // A string `bin` (or none) maps to the unscoped package name.
  return packageName.includes("/") ? packageName.split("/")[1] : packageName;
}

// Reads this CLI's own package.json. After bundling, every module collapses
// into dist/index.js, so package.json is one directory up from the module dir
// in both the bundled and source layouts.
export function getOwnPackage(): OwnPackage | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf-8")) as {
      name?: unknown,
      version?: unknown,
      bin?: unknown,
    };
    if (typeof pkg.name !== "string" || typeof pkg.version !== "string") return null;
    return {
      name: pkg.name,
      version: pkg.version,
      binName: resolveBinName(pkg.bin, pkg.name),
    };
  } catch {
    return null;
  }
}

export function cliVersion(): string | undefined {
  return getOwnPackage()?.version;
}

function npmRegistry(): string {
  const fromEnv = process.env.npm_config_registry ?? process.env.NPM_CONFIG_REGISTRY;
  const base = fromEnv != null && fromEnv.trim().length > 0 ? fromEnv.trim() : DEFAULT_REGISTRY;
  return base.replace(/\/+$/, "");
}

function encodePackageName(name: string): string {
  // Scoped packages contain a single `/` that must be percent-encoded for the
  // registry path; the leading `@` is left as-is.
  return name.replace("/", "%2f");
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function updateCheckTimeoutMs(): number {
  return positiveIntEnv("STACK_CLI_UPDATE_CHECK_TIMEOUT_MS", DEFAULT_UPDATE_CHECK_TIMEOUT_MS);
}

export function updateCheckTtlMs(): number {
  return positiveIntEnv("STACK_CLI_UPDATE_CHECK_TTL_MS", DEFAULT_UPDATE_CHECK_TTL_MS);
}

async function fetchLatestVersion(packageName: string, timeoutMs: number): Promise<string | null> {
  // Manual AbortController instead of AbortSignal.timeout: the latter isn't
  // present on jsdom's AbortSignal (the test environment), and evaluating it
  // would throw before fetch is even reached.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${npmRegistry()}/${encodePackageName(packageName)}/latest`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = await res.json() as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Resolves the latest published version, memoizing the result in the dev-env
// state file for `ttlMs` so back-to-back `stack dev` runs don't hammer the
// registry. Returns null when the registry can't be reached (offline,
// timeout) so callers fall back to the installed CLI.
export async function resolveLatestVersion(
  packageName: string,
  opts: { timeoutMs: number, ttlMs: number, now?: number },
): Promise<string | null> {
  const now = opts.now ?? Date.now();
  const cache = readCliUpdateCheckCache();
  if (cache != null && cache.packageName === packageName && now - cache.checkedAtMillis < opts.ttlMs) {
    return cache.latestVersion;
  }
  const latest = await fetchLatestVersion(packageName, opts.timeoutMs);
  if (latest == null) return null;
  writeCliUpdateCheckCache({ packageName, latestVersion: latest, checkedAtMillis: now });
  return latest;
}

export type NpxInvocation = {
  command: string,
  args: string[],
};

export function buildNpxInvocation(opts: {
  packageName: string,
  version: string,
  binName: string,
  forwardArgs: string[],
}): NpxInvocation {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  return {
    command,
    args: ["--yes", "-p", `${opts.packageName}@${opts.version}`, opts.binName, ...opts.forwardArgs],
  };
}

type ReexecResult =
  | { exited: true, code: number }
  | { exited: false, error: string };

function runReexec(invocation: NpxInvocation): Promise<ReexecResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(invocation.command, invocation.args, {
      stdio: "inherit",
      env: { ...process.env, [SKIP_AUTO_UPDATE_ENV]: "1" },
    });

    const forward = (signal: NodeJS.Signals) => () => {
      try {
        child.kill(signal);
      } catch {
        // best-effort
      }
    };
    const onSigint = forward("SIGINT");
    const onSigterm = forward("SIGTERM");
    const cleanup = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    child.on("close", (code) => {
      cleanup();
      resolvePromise({ exited: true, code: code ?? 1 });
    });
    // npx missing / not spawnable: report so the caller can fall back to the
    // installed CLI instead of failing the whole `stack dev`.
    child.on("error", (err) => {
      cleanup();
      resolvePromise({ exited: false, error: err.message });
    });
  });
}

// If a newer version of this CLI is published, re-runs the requested command
// through `npx <pkg>@<latest>` so the user gets the latest dashboard without
// reinstalling, then exits with the child's code. Best-effort: any failure
// (offline, no npx, opted out) silently falls through to the installed CLI.
export async function maybeReexecToLatest(opts: { forwardArgs: string[] }): Promise<void> {
  if (!shouldAutoUpdate(process.env)) return;

  const pkg = getOwnPackage();
  if (pkg == null) return;

  const latest = await resolveLatestVersion(pkg.name, {
    timeoutMs: updateCheckTimeoutMs(),
    ttlMs: updateCheckTtlMs(),
  });
  if (latest == null) return;
  if (!isVersionNewer(latest, pkg.version)) return;

  logUpdate(
    `A newer ${pkg.name} (${latest}) is available; re-running via npx to use the latest dashboard. ` +
    `Set ${DISABLE_AUTO_UPDATE_ENV}=1 to disable.`,
  );

  const invocation = buildNpxInvocation({
    packageName: pkg.name,
    version: latest,
    binName: pkg.binName,
    forwardArgs: opts.forwardArgs,
  });
  const result = await runReexec(invocation);
  if (result.exited) {
    process.exit(result.code);
  }
  logUpdate(`Could not run npx (${result.error}); continuing with the installed CLI.`);
}
