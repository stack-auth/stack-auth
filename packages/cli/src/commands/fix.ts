import { Command } from "commander";

type FixOptions = { error?: string, yes?: boolean };

export function registerFixCommand(program: Command) {
  program.command("fix").description("Use an AI agent to fix a Hexclave error in your project").option("--error <text>", "The error message to fix (also accepts stdin)").option("-y, --yes", "Skip the confirmation prompt").action(async (opts: FixOptions) => {
    const { run } = await import("./fix.impl.js");
    await run(opts);
  });
}
