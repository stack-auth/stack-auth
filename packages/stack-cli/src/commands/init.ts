import { Command } from "commander";
import { execFileSync } from "child_process";

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Initialize Stack Auth in your project (delegates to @stackframe/init-stack)")
    .allowUnknownOption(true)
    .helpOption(false)
    .action((_opts, cmd) => {
      const args = cmd.args as string[];
      execFileSync("npx", ["@stackframe/init-stack@latest", ...args], {
        stdio: "inherit",
      });
    });
}
