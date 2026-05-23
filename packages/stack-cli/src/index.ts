import { initSentry } from "./lib/sentry.js";
initSentry();

import * as Sentry from "@sentry/node";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
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
import { registerDevCommand } from "./commands/dev.js";
import { registerFixCommand } from "./commands/fix.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerWhoamiCommand } from "./commands/whoami.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

const program = new Command();

program
  .name("stack")
  .description("Stack Auth CLI")
  .version(pkg.version)
  .option("--json", "Output in JSON format");

registerLoginCommand(program);
registerLogoutCommand(program);
registerExecCommand(program);
registerConfigCommand(program);
registerInitCommand(program);
registerProjectCommand(program);
registerEmulatorCommand(program);
registerDevCommand(program);
registerWhoamiCommand(program);
registerFixCommand(program);
registerDoctorCommand(program);

async function main() {
  try {
    const argv = process.argv[2] === "--"
      ? [process.argv[0], process.argv[1], ...process.argv.slice(3)]
      : process.argv;
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof AuthError) {
      console.error(`Auth error: ${err.message}`);
      process.exit(1);
    }
    if (err instanceof CliError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    captureError("stack-cli-fatal", err);
    await Sentry.flush(2000);
    console.error(err);
    process.exit(1);
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
