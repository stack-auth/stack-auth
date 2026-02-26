import { Command } from "commander";

export function registerUpdateCommand(program: Command) {
  program
    .command("update")
    .description("Show version information")
    .action(() => {
      const version = program.version();
      console.log(`stack-cli version: ${version}`);
      console.log("\nWhen using npx @stackframe/stack-cli, you always get the latest version.");
      console.log("No manual update is needed.");
    });
}
