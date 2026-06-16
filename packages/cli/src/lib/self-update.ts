import { spawn } from "child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { forwardSignals } from "./child-process.js";
import { getOwnPackage, type OwnPackage } from "./own-package.js";

// Set on the process we re-exec via npx so the child doesn't try to update
// itself again (it already *is* the latest), preventing an infinite loop.
export const SKIP_AUTO_UPDATE_ENV = "STACK_CLI_SKIP_AUTO_UPDATE";
// User-facing opt-out. Set to a truthy value to never auto-update.
export const DISABLE_AUTO_UPDATE_ENV = "STACK_CLI_NO_AUTO_UPDATE";
// Path to a marker file the re-exec'd child touches the instant it starts. The
// parent uses its presence to tell a genuine command failure (our CLI ran and
// exited nonzero) from an npx/install failure where our CLI never ran at all
// (e.g. npm "Lock compromised" on sandboxed/networked filesystems). Set by the
// parent on the child's env; read back by the parent after the child exits.
export const REEXEC_MARKER_ENV = "STACK_CLI_REEXEC_MARKER";

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

// Auto-update is skipped only when we're the re-exec'd child or when the user
// explicitly opted out. We intentionally still auto-update in CI: pinning a
// different version there than developers run locally is exactly the kind of
// drift that hides "works on my machine" bugs.
export function shouldAutoUpdate(env: NodeJS.ProcessEnv): boolean {
  if (isEnvFlagEnabled(env[SKIP_AUTO_UPDATE_ENV])) return false;
  if (isEnvFlagEnabled(env[DISABLE_AUTO_UPDATE_ENV])) return false;
  return true;
}

export type NpxInvocation = {
  command: string,
  args: string[],
  // Windows' launcher is `npx.cmd`; after CVE-2024-27980 Node refuses to spawn
  // a .cmd/.bat directly (EINVAL) unless `shell` is set, so the re-exec has to
  // go through the shell there. `args` stays a clean argv array — runReexec
  // quotes it for the shell at spawn time.
  shell: boolean,
};

export function buildNpxInvocation(opts: {
  packageName: string,
  binName: string,
  forwardArgs: string[],
}): NpxInvocation {
  const isWindows = process.platform === "win32";
  const command = isWindows ? "npx.cmd" : "npx";
  return {
    command,
    shell: isWindows,
    args: [
      "--yes",
      // Override any global npm "cooldown" for this call only — we always want
      // the just-published latest, and npx of a version newer than the cooldown
      // window otherwise fails with ETARGET (which would kill `hexclave dev`).
      // npm's config is `min-release-age` (days, npm >=11.10.0); older npm
      // silently ignores the unknown flag.
      "--min-release-age=0",
      "-p",
      // Always pin `@latest`: npm resolves the newest published version, so we
      // don't need to fetch-and-compare versions ourselves. The re-exec'd child
      // carries SKIP_AUTO_UPDATE_ENV, so it runs that downloaded CLI directly
      // instead of recursing.
      `${opts.packageName}@latest`,
      opts.binName,
      ...opts.forwardArgs,
    ],
  };
}

export type ReexecDecision =
  | { reexec: false, reason: "disabled" | "no-package" }
  | { reexec: true, invocation: NpxInvocation };

// Pure decision: given the environment, our own package, and the args to
// forward, decide whether (and how) to re-exec through `npx <pkg>@latest`. Kept
// free of I/O so the branching can be unit-tested directly. We re-exec unless
// auto-update is off or we can't resolve our own package name.
export function decideReexec(opts: {
  env: NodeJS.ProcessEnv,
  pkg: OwnPackage | null,
  forwardArgs: string[],
}): ReexecDecision {
  if (!shouldAutoUpdate(opts.env)) return { reexec: false, reason: "disabled" };
  if (opts.pkg == null) return { reexec: false, reason: "no-package" };
  return {
    reexec: true,
    invocation: buildNpxInvocation({
      packageName: opts.pkg.name,
      binName: opts.pkg.binName,
      forwardArgs: opts.forwardArgs,
    }),
  };
}

export type ReexecResult =
  | { exited: true, code: number }
  | { exited: false, error: string };

// Quote an argument for the single cmd.exe command line that Node builds when
// `spawn` runs with `shell: true` on Windows — it joins argv with spaces and
// does not quote, so an unquoted path/arg with a space would be split. Wrap
// anything that isn't a plain token (and the empty string) in double quotes,
// escaping embedded quotes. A no-op on the non-shell (POSIX) path.
function quoteShellArg(arg: string): string {
  if (arg !== "" && !/[\s"&|<>^()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function runReexec(invocation: NpxInvocation, markerFile: string | null): Promise<ReexecResult> {
  return new Promise((resolvePromise) => {
    const args = invocation.shell ? invocation.args.map(quoteShellArg) : invocation.args;
    const env: NodeJS.ProcessEnv = { ...process.env, [SKIP_AUTO_UPDATE_ENV]: "1" };
    if (markerFile != null) env[REEXEC_MARKER_ENV] = markerFile;
    const child = spawn(invocation.command, args, {
      stdio: "inherit",
      env,
      shell: invocation.shell,
    });
    const cleanup = forwardSignals(child);

    child.on("close", (code) => {
      cleanup();
      resolvePromise({ exited: true, code: code ?? 1 });
    });
    // npx missing / not spawnable: report so the caller can fall back to the
    // installed CLI instead of failing the whole `hexclave dev`.
    child.on("error", (err) => {
      cleanup();
      resolvePromise({ exited: false, error: err.message });
    });
  });
}

// What the parent should do once the re-exec'd npx process is done. Kept pure so
// the fallback branching can be unit-tested without spawning anything.
//   - exit:     propagate the child's exit code (it ran our CLI to completion)
//   - fallback: the update attempt failed before our CLI ran — run the installed
//               CLI inline instead of taking down `hexclave dev`
export type PostReexecAction =
  | { kind: "exit", code: number }
  | { kind: "fallback", detail: string };

// `started` is whether the re-exec'd CLI actually began running (its startup
// marker appeared). A nonzero exit *with* the CLI started is a real command
// failure and must propagate. A nonzero exit *without* it — or npx not being
// spawnable at all — means the auto-update failed before our CLI ran (e.g. npm
// "Lock compromised" on Replit/Docker/WSL/NFS filesystems, ETARGET, registry or
// network errors); auto-update is best-effort, so we fall back.
export function decidePostReexec(opts: { result: ReexecResult, started: boolean }): PostReexecAction {
  const { result, started } = opts;
  if (!result.exited) {
    return { kind: "fallback", detail: `could not run npx (${result.error})` };
  }
  if (result.code !== 0 && !started) {
    return { kind: "fallback", detail: `npx exited with code ${result.code} before the CLI started` };
  }
  return { kind: "exit", code: result.code };
}

// Create a unique, empty marker directory; the child writes a file inside it on
// startup. Returns null if the temp dir can't be created, in which case the
// caller treats every exit as "the CLI started" (i.e. preserves the old
// always-propagate behavior rather than risk a spurious fallback).
function createReexecMarker(): { dir: string, file: string } | null {
  try {
    const dir = mkdtempSync(join(tmpdir(), "hexclave-reexec-"));
    return { dir, file: join(dir, "started") };
  } catch {
    return null;
  }
}

function cleanupReexecMarker(marker: { dir: string } | null): void {
  if (marker == null) return;
  try {
    rmSync(marker.dir, { recursive: true, force: true });
  } catch {
    // best-effort temp cleanup
  }
}

// Called at the very start of the (potential) re-exec. When we are the
// npx-spawned child — identified by the marker path the parent put on our env —
// touch the marker so the parent knows the latest CLI actually started. No-op in
// the normal top-level invocation, where no marker env var is set.
export function signalReexecStartedIfChild(env: NodeJS.ProcessEnv): void {
  const markerFile = env[REEXEC_MARKER_ENV];
  if (markerFile == null || markerFile === "") return;
  try {
    writeFileSync(markerFile, "1");
  } catch {
    // best-effort; if we can't write it the parent simply propagates the exit
    // code as before — no worse than the pre-fallback behavior.
  }
}

// Re-runs the requested command through `npx <pkg>@latest` so the user always
// gets the latest CLI + dashboard without reinstalling, then exits with the
// child's code. The re-exec'd child carries SKIP_AUTO_UPDATE_ENV so it runs the
// freshly downloaded CLI directly instead of recursing, and a marker path so it
// can signal that it started. Best-effort: if the update fails before our CLI
// runs — npx not spawnable, or npx/npm itself erroring (e.g. "Lock compromised"
// on sandboxed filesystems) — we fall back to the installed CLI instead of
// failing `hexclave dev`.
export async function maybeReexecToLatest(opts: { forwardArgs: string[] }): Promise<void> {
  // If npx already re-exec'd us to the latest CLI, record that we started so the
  // parent can tell a real command failure apart from an npx/install failure.
  signalReexecStartedIfChild(process.env);

  let marker: { dir: string, file: string } | null = null;
  try {
    const decision = decideReexec({
      env: process.env,
      pkg: getOwnPackage(),
      forwardArgs: opts.forwardArgs,
    });
    if (!decision.reexec) return;

    marker = createReexecMarker();
    const result = await runReexec(decision.invocation, marker?.file ?? null);
    // No marker means we couldn't create one; treat that as "started" so we keep
    // the old always-propagate behavior rather than fall back spuriously.
    const started = marker == null || existsSync(marker.file);
    cleanupReexecMarker(marker);
    marker = null;

    const action = decidePostReexec({ result, started });
    if (action.kind === "exit") {
      process.exit(action.code);
    }
    logUpdate(`Auto-update skipped: ${action.detail}; continuing with the installed CLI.`);
  } catch {
    // Fail open: any unexpected error must not block the installed CLI from
    // running.
  } finally {
    // Covers the early-return / throw / opt-out paths; the success path already
    // cleaned up before process.exit (which would skip finally).
    cleanupReexecMarker(marker);
  }
}
