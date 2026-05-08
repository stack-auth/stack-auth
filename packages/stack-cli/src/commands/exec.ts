import { Command } from "commander";
import { isProjectAuthWithRefreshToken, resolveAuth, resolveLocalEmulatorAuth, type ProjectAuthWithRefreshToken } from "../lib/auth.js";
import { getAdminProject } from "../lib/app.js";
import { CliError } from "../lib/errors.js";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export type ExecTarget = "cloud" | "local";

// Decide whether `stack exec` should target the cloud API or the local emulator.
// `--cloud` always wins. Otherwise STACK_EXEC_DEFAULT_TARGET picks the default
// (local if unset). Anything other than "cloud" or "local" is rejected so a
// typo doesn't silently fall back to one branch.
export function resolveExecTarget(opts: { cloud?: boolean }, env: NodeJS.ProcessEnv): ExecTarget {
  if (opts.cloud) return "cloud";
  const raw = env.STACK_EXEC_DEFAULT_TARGET;
  if (raw === undefined || raw === "") return "local";
  if (raw !== "cloud" && raw !== "local") {
    throw new CliError(`Invalid STACK_EXEC_DEFAULT_TARGET: ${raw}. Must be 'cloud' or 'local'.`);
  }
  return raw;
}

export function registerExecCommand(program: Command) {
  program
    .command("exec [javascript]")
    .description("Execute JavaScript with a pre-configured StackServerApp as `stackServerApp`. Defaults to the local emulator; pass --cloud to target the Stack Auth cloud API.")
    .option("--cloud", "Run against the Stack Auth cloud API instead of the local emulator")
    .addHelpText("after", "\nFor available API methods, see: https://docs.stack-auth.com/docs/sdk")
    .action(async (javascript: string | undefined, opts: { cloud?: boolean }) => {
      if (javascript === undefined) {
        throw new CliError("Missing JavaScript argument. Use `stack exec \"<javascript>\"` or `stack exec --help`.");
      }

      const flags = program.opts();
      const target = resolveExecTarget(opts, process.env);
      let auth: ProjectAuthWithRefreshToken;
      if (target === "cloud") {
        const cloudAuth = resolveAuth(flags);
        if (!isProjectAuthWithRefreshToken(cloudAuth)) {
          throw new CliError("`stack exec --cloud` requires `stack login`. Remove STACK_SECRET_SERVER_KEY and try again.");
        }
        auth = cloudAuth;
      } else {
        auth = await resolveLocalEmulatorAuth(flags);
      }
      const project = await getAdminProject(auth);

      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      let fn;
      try {
        fn = new AsyncFunction("stackServerApp", javascript);
      } catch (err: unknown) {
        throw new CliError(`Syntax error in exec code: ${getErrorMessage(err)}`);
      }
      let result;
      try {
        result = await fn(project.app);
      } catch (err: unknown) {
        throw new CliError(`Exec error: ${getErrorMessage(err)}`);
      }

      if (result !== undefined) {
        console.log(JSON.stringify(result, null, 2));
      }
    });
}
