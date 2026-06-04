import { spawn } from "child_process";
import { forwardSignals } from "./child-process.js";
import { getOwnPackage, type OwnPackage } from "./own-package.js";

// Set on the process we re-exec via npx so the child doesn't try to update
// itself again (it already *is* the latest), preventing an infinite loop.
export const SKIP_AUTO_UPDATE_ENV = "STACK_CLI_SKIP_AUTO_UPDATE";
// User-facing opt-out. Set to a truthy value to never auto-update.
export const DISABLE_AUTO_UPDATE_ENV = "STACK_CLI_NO_AUTO_UPDATE";

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

type ReexecResult =
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

function runReexec(invocation: NpxInvocation): Promise<ReexecResult> {
  return new Promise((resolvePromise) => {
    const args = invocation.shell ? invocation.args.map(quoteShellArg) : invocation.args;
    const child = spawn(invocation.command, args, {
      stdio: "inherit",
      env: { ...process.env, [SKIP_AUTO_UPDATE_ENV]: "1" },
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

// Re-runs the requested command through `npx <pkg>@latest` so the user always
// gets the latest CLI + dashboard without reinstalling, then exits with the
// child's code. The re-exec'd child carries SKIP_AUTO_UPDATE_ENV so it runs the
// freshly downloaded CLI directly instead of recursing. Best-effort: if npx
// can't be spawned (or auto-update is off / opted out) we silently fall through
// to the installed CLI.
export async function maybeReexecToLatest(opts: { forwardArgs: string[] }): Promise<void> {
  try {
    const decision = decideReexec({
      env: process.env,
      pkg: getOwnPackage(),
      forwardArgs: opts.forwardArgs,
    });
    if (!decision.reexec) return;

    const result = await runReexec(decision.invocation);
    if (result.exited) {
      process.exit(result.code);
    }
    logUpdate(`Could not run npx (${result.error}); continuing with the installed CLI.`);
  } catch {
    // Fail open: any unexpected error must not block the installed CLI from
    // running.
  }
}
