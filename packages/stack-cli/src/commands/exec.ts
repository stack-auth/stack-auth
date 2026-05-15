import { Command } from "commander";
import { isProjectAuthWithRefreshToken, resolveAuth, resolveLocalEmulatorAuth, type ProjectAuthWithRefreshToken } from "../lib/auth.js";
import { lookupLocalEmulatorProjectIdByPath } from "../lib/local-emulator-client.js";
import { getAdminProject } from "../lib/app.js";
import { CliError } from "../lib/errors.js";
import { resolveConfigFilePathOption } from "../lib/config-file-path.js";

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

export type ExecTargetOpts = {
  cloudProjectId?: string,
  configFile?: string,
};

export type ExecTarget =
  | { kind: "cloud", projectId: string }
  | { kind: "config", configFile: string };

// Validate that exactly one of --cloud-project-id / --config-file was provided
// and return a tagged target. Both branches are mutually exclusive; passing
// neither (or both) is rejected so the user has to make the cloud-vs-local
// choice explicit at every invocation.
export function parseExecTarget(opts: ExecTargetOpts): ExecTarget {
  const hasCloud = opts.cloudProjectId != null && opts.cloudProjectId !== "";
  const hasConfig = opts.configFile != null && opts.configFile !== "";
  if (hasCloud && hasConfig) {
    throw new CliError("Pass either --cloud-project-id or --config-file, not both.");
  }
  if (!hasCloud && !hasConfig) {
    throw new CliError("Specify a target: pass --cloud-project-id <id> for the Stack Auth cloud API, or --config-file <path> for the local emulator.");
  }
  if (hasCloud) {
    return { kind: "cloud", projectId: opts.cloudProjectId as string };
  }
  return { kind: "config", configFile: opts.configFile as string };
}

export function registerExecCommand(program: Command) {
  program
    .command("exec [javascript]")
    .description("Execute JavaScript with a pre-configured StackServerApp as `stackServerApp`. Pass --cloud-project-id <id> for the cloud API, or --config-file <path> for the local emulator.")
    .option("--cloud-project-id <id>", "Cloud project ID to run against (use --config-file instead for the local emulator)")
    .option("--config-file <path>", "Path to a local emulator stack.config.ts (use --cloud-project-id instead for the cloud API)")
    .addHelpText("after", "\nFor available API methods, see: https://docs.stack-auth.com/docs/sdk")
    .action(async (javascript: string | undefined, opts: ExecTargetOpts) => {
      if (javascript === undefined) {
        throw new CliError("Missing JavaScript argument. Use `stack exec \"<javascript>\"` or `stack exec --help`.");
      }

      const target = parseExecTarget(opts);
      let auth: ProjectAuthWithRefreshToken;
      if (target.kind === "cloud") {
        const cloudAuth = resolveAuth(target.projectId);
        if (!isProjectAuthWithRefreshToken(cloudAuth)) {
          throw new CliError("`stack exec --cloud-project-id` requires `stack login`. Remove STACK_SECRET_SERVER_KEY and try again.");
        }
        auth = cloudAuth;
      } else {
        const absPath = resolveConfigFilePathOption(target.configFile, { mustExist: true });
        const projectId = await lookupLocalEmulatorProjectIdByPath(absPath);
        auth = await resolveLocalEmulatorAuth(projectId);
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
