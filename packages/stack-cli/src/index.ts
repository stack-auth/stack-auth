import { initSentry, reportUnexpectedError, flushSentry } from "./lib/sentry.js";
initSentry();

import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { AuthError, CliError } from "./lib/errors.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerLogoutCommand } from "./commands/logout.js";
import { registerExecCommand } from "./commands/exec.js";
import { registerConfigCommand } from "./commands/config-file.js";
import { registerInitCommand } from "./commands/init.js";
import { registerProjectCommand } from "./commands/project.js";
import { registerEmulatorCommand } from "./commands/emulator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

const program = new Command();

program
  .name("stack")
  .description("Stack Auth CLI")
  .version(pkg.version)
  .option("--project-id <id>", "Project ID")
  .option("--json", "Output in JSON format");

registerLoginCommand(program);
registerLogoutCommand(program);
registerExecCommand(program);
registerConfigCommand(program);
registerInitCommand(program);
registerProjectCommand(program);
registerEmulatorCommand(program);

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof AuthError) {
      console.error(`Auth error: ${err.message}`);
      process.exit(1);
    }
    if (err instanceof CliError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    await handleFatal(err);
  }
}

async function handleFatal(err: unknown): Promise<never> {
  try {
    reportUnexpectedError(err);
    await flushSentry();
  } catch {
    // best-effort
  }
  console.error(err);
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
