import { Command } from "commander";
import type { InitOptions } from "./init.impl.js";

export function registerInitCommand(program: Command) {
  program.command("init").description("Initialize Hexclave in your project").option("--mode <mode>", "Mode: create, create-cloud, link-config, or link-cloud (skips interactive prompts)").option("--apps <apps>", "Comma-separated app IDs to enable (for create mode)").option("--config-file <path>", "Path to existing config file (for link-config mode)").option("--select-project-id <id>", "Project ID to link (for link-cloud mode)").option("--output-dir <dir>", "Directory to write output files (defaults to cwd)").option("--no-agent", "Skip Claude agent and print setup instructions instead").option("--display-name <name>", "Project display name (used by create-cloud mode)").action(async (opts: InitOptions) => {
    const { run } = await import("./init.impl.js");
    await run(program, opts);
  });
}
