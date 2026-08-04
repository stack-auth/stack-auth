import { Command } from "commander";

type DevOptions = { configFile?: string };
type ChildCommand = {
  command: string,
  args: string[],
};

export function registerDevCommand(program: Command) {
  program.command("dev").usage("--config-file <path> -- <command> [args...]").description("Run a command with Hexclave development-environment credentials").requiredOption("--config-file <path>", "Path to stack.config.ts").argument("<command...>", "Command and arguments to run after --").action(async (commandArgs: string[], opts: DevOptions) => {
    const { run } = await import("./dev.impl.js");
    await run(commandArgs, opts);
  });
}

export function runChildProcess(command: ChildCommand, env: NodeJS.ProcessEnv): Promise<number> {
  return import("./dev.impl.js").then(({ runChildProcess: run }) => run(command, env));
}
