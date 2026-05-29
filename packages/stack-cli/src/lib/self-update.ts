import { spawn } from "child_process";
import { forwardSignals } from "./child-process.js";
import { readCliUpdateCheckCache, writeCliUpdateCheckCache } from "./dev-env-state.js";
import { getOwnPackage, type OwnPackage } from "./own-package.js";

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
// can't reason about (and never downgrade). Prerelease identifiers beyond the
// "release beats same-core prerelease" rule are intentionally not ordered.
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
  // Manual AbortController + clearTimeout (rather than AbortSignal.timeout) so
  // the timer is always cleared on the fast path and we stay compatible with
  // older Node runtimes that lack AbortSignal.timeout.
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
    args: [
      "--yes",
      // Override any global npm "cooldown" for this call only — we always want
      // the just-published latest, and npx of a pinned version newer than the
      // cooldown window otherwise fails with ETARGET (which would kill
      // `stack dev`). npm's config is `min-release-age` (days, npm >=11.10.0);
      // older npm silently ignores the unknown flag.
      "--min-release-age=0",
      "-p",
      `${opts.packageName}@${opts.version}`,
      opts.binName,
      ...opts.forwardArgs,
    ],
  };
}

export type ReexecDecision =
  | { reexec: false, reason: "disabled" | "no-package" | "no-latest" | "not-newer" }
  | { reexec: true, invocation: NpxInvocation };

// Pure decision: given the environment, our own package, the resolved latest
// version, and the args to forward, decide whether (and how) to re-exec. Kept
// free of I/O so the branching can be unit-tested directly.
export function decideReexec(opts: {
  env: NodeJS.ProcessEnv,
  pkg: OwnPackage | null,
  latest: string | null,
  forwardArgs: string[],
}): ReexecDecision {
  if (!shouldAutoUpdate(opts.env)) return { reexec: false, reason: "disabled" };
  if (opts.pkg == null) return { reexec: false, reason: "no-package" };
  if (opts.latest == null) return { reexec: false, reason: "no-latest" };
  if (!isVersionNewer(opts.latest, opts.pkg.version)) return { reexec: false, reason: "not-newer" };
  return {
    reexec: true,
    invocation: buildNpxInvocation({
      packageName: opts.pkg.name,
      version: opts.latest,
      binName: opts.pkg.binName,
      forwardArgs: opts.forwardArgs,
    }),
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
    const cleanup = forwardSignals(child);

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
  try {
    // Fast-path: don't even hit the registry when auto-update is off.
    if (!shouldAutoUpdate(process.env)) return;

    const pkg = getOwnPackage();
    if (pkg == null) return;

    const latest = await resolveLatestVersion(pkg.name, {
      timeoutMs: updateCheckTimeoutMs(),
      ttlMs: updateCheckTtlMs(),
    });

    const decision = decideReexec({ env: process.env, pkg, latest, forwardArgs: opts.forwardArgs });
    if (!decision.reexec) return;

    const result = await runReexec(decision.invocation);
    if (result.exited) {
      process.exit(result.code);
    }
    logUpdate(`Could not run npx (${result.error}); continuing with the installed CLI.`);
  } catch {
    // Fail open: a corrupt/unreadable state file, a disk-full cache write, or
    // any other unexpected error must not block the installed CLI from running.
    // A genuine state-file problem resurfaces later in the normal dev flow.
  }
}
