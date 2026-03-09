import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { resolveAuth } from "../lib/auth.js";
import { getAdminProject } from "../lib/app.js";
import { CliError } from "../lib/errors.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function registerConfigCommand(program: Command) {
  const config = program
    .command("config")
    .description("Manage project configuration files");

  config
    .command("pull")
    .description("Pull branch config to a local file")
    .requiredOption("--config-file <path>", "Path to write config file (.js or .ts)")
    .action(async (opts) => {
      const flags = program.opts();
      const auth = resolveAuth(flags);
      const project = await getAdminProject(auth);

      const configOverride = await project.getConfigOverride("branch");
      const filePath = path.resolve(opts.configFile);
      const ext = path.extname(filePath);

      if (ext !== ".js" && ext !== ".ts") {
        throw new CliError("Config file must have a .js or .ts extension.");
      }

      const json = JSON.stringify(configOverride, null, 2);
      const content = ext === ".ts"
        ? `export const config = ${json} as const;\n`
        : `export const config = ${json};\n`;

      fs.writeFileSync(filePath, content);
      console.log(`Config written to ${filePath}`);
    });

  config
    .command("push")
    .description("Push a local config file to branch config")
    .requiredOption("--config-file <path>", "Path to config file (.js or .ts)")
    .action(async (opts) => {
      const flags = program.opts();
      const auth = resolveAuth(flags);
      const project = await getAdminProject(auth);

      const filePath = path.resolve(opts.configFile);
      const ext = path.extname(filePath);

      if (ext !== ".js" && ext !== ".ts") {
        throw new CliError("Config file must have a .js or .ts extension.");
      }

      if (!fs.existsSync(filePath)) {
        throw new CliError(`Config file not found: ${filePath}`);
      }

      let configModule: { config?: unknown };
      if (ext === ".ts") {
        const { createJiti } = await import("jiti");
        const jiti = createJiti(import.meta.url);
        configModule = await jiti.import(filePath);
      } else {
        configModule = await import(filePath);
      }

      const config = configModule.config;
      if (!isPlainObject(config)) {
        throw new CliError("Config file must export a plain `config` object. Example: export const config = { ... };");
      }

      await project.replaceConfigOverride("branch", config);
      console.log("Config pushed successfully.");
    });
}
