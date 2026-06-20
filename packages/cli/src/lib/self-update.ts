import { spawn } from "child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { constants as osConstants, tmpdir } from "os";
import { join } from "path";
import { forwardSignals } from "./child-process.js";
import { getOwnPackage, type OwnPackage } from "./own-package.js";

// Set on the process we re-exec via npx so the child doesn't try to update
// itself again (it already *is* the latest), preventing an infinite loop.
export const SKIP_AUTO_UPDATE_ENV = "STACK_CLI_SKIP_AUTO_UPDATE";
// User-facing opt-out. Set to a truthy value to never auto-update.
export const DISABLE_AUTO_UPDATE_ENV = "STACK_CLI_NO_AUTO_UPDATE";
// Marker file the re-exec'd child touches on startup; its presence lets the
// parent tell a real command failure from an npx/install failure where our CLI
// never ran. Set by the parent on the child's env.
export const REEXEC_MARKER_ENV = "HEXCLAVE_CLI_REEXEC_MARKER";

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
  // `signal` is set when the child was killed by one (e.g. a forwarded Ctrl-C),
  // distinguishing an abort from an npx failure (a bare exit code can't).
  | { exited: true, code: number, signal: NodeJS.Signals | null }
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

    child.on("close", (code, signal) => {
      cleanup();
      if (signal != null) {
        // Report the conventional 128 + signal-number exit code. The lookup can
        // be undefined at runtime (not every signal is in os.constants.signals on
        // every platform); 128 + undefined is NaN and process.exit(NaN) coerces
        // to 0, masking the abort — so fall back to a generic nonzero code.
        const signalNumber = osConstants.signals[signal] as number | undefined;
        const code = signalNumber != null ? 128 + signalNumber : 1;
        resolvePromise({ exited: true, code, signal });
        return;
      }
      resolvePromise({ exited: true, code: code ?? 1, signal: null });
    });
    // npx missing / not spawnable: report so the caller can fall back to the
    // installed CLI instead of failing the whole `hexclave dev`.
    child.on("error", (err) => {
      cleanup();
      resolvePromise({ exited: false, error: err.message });
    });
  });
}

// What the parent does once the re-exec'd npx process is done: `exit` propagates
// the child's code (our CLI ran), `fallback` runs the installed CLI inline (the
// update failed before our CLI ran). Pure so it can be unit-tested.
export type PostReexecAction =
  | { kind: "exit", code: number }
  | { kind: "fallback", detail: string };

// `started` = whether the re-exec'd CLI's startup marker appeared. A nonzero
// exit with it started is a real failure (propagate); without it — or npx not
// spawnable — the update failed before our CLI ran, so we fall back.
export function decidePostReexec(opts: { result: ReexecResult, started: boolean }): PostReexecAction {
  const { result, started } = opts;
  if (!result.exited) {
    return { kind: "fallback", detail: `could not run npx (${result.error})` };
  }
  // Killed by a forwarded signal (e.g. Ctrl-C): the user wants to abort, not
  // relaunch dev on the installed CLI. Propagate instead of falling back.
  if (result.signal != null) {
    return { kind: "exit", code: result.code };
  }
  if (result.code !== 0 && !started) {
    return { kind: "fallback", detail: `npx exited with code ${result.code} before the CLI started` };
  }
  return { kind: "exit", code: result.code };
}

// Create a unique marker dir; the child writes a file inside it on startup.
// Returns null if the temp dir can't be created, in which case the caller treats
// every exit as "started" (preserving the old always-propagate behavior).
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

// When we're the npx-spawned child (the parent set the marker env), touch the
// marker so the parent knows the latest CLI started. No-op at top level.
export function signalReexecStartedIfChild(env: NodeJS.ProcessEnv): void {
  const markerFile = env[REEXEC_MARKER_ENV];
  if (markerFile == null || markerFile === "") return;
  try {
    writeFileSync(markerFile, "1");
  } catch {
    // best-effort; if the write fails the parent just propagates as before.
  }
}

// Re-runs the command through `npx <pkg>@latest` so the user always gets the
// latest CLI + dashboard without reinstalling, then exits with the child's code.
// The child carries SKIP_AUTO_UPDATE_ENV (run directly, don't recurse) and a
// marker path to signal it started. Best-effort: if the update fails before our
// CLI runs we fall back to the installed CLI instead of failing `hexclave dev`.
export async function maybeReexecToLatest(opts: { forwardArgs: string[] }): Promise<void> {
  // If npx re-exec'd us to the latest CLI, record that we started so the parent
  // can tell a real command failure from an npx/install failure.
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
    // No marker (couldn't create one): treat as "started" to keep the old
    // always-propagate behavior rather than fall back spuriously.
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
    // Covers early-return/throw/opt-out paths; the success path already cleaned
    // up before process.exit (which skips finally).
    cleanupReexecMarker(marker);
  }
}
