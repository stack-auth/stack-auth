import { Command } from "commander";
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
    throw new CliError("Specify a target: pass --cloud-project-id <id> for the Hexclave cloud API, or --config-file <path> for the development environment.");
  }
  if (hasCloud) {
    return { kind: "cloud", projectId: opts.cloudProjectId as string };
  }
  return { kind: "config", configFile: opts.configFile as string };
}


export function registerExecCommand(program: Command) {
  program.command("exec [javascript]")
    .description("Execute JavaScript with a pre-configured StackServerApp as `hexclaveServerApp`. Pass --cloud-project-id <id> for the cloud API, or --config-file <path> for the development environment.")
    .option("--cloud-project-id <id>", "Cloud project ID to run against (use --config-file instead for the development environment)")
    .option("--config-file <path>", "Path to a development-environment stack.config.ts (use --cloud-project-id instead for the cloud API)")
    .addHelpText("after", "\nFor available API methods, see: https://docs.hexclave.com/sdk/overview")
    .action(async (javascript: string | undefined, opts: ExecTargetOpts) => {
      const { run } = await import("./exec.impl.js");
      await run(javascript, opts);
    });
}
