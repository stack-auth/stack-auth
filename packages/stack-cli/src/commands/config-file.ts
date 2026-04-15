import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { resolveAuth } from "../lib/auth.js";
import { getAdminProject } from "../lib/app.js";
import { CliError } from "../lib/errors.js";
import { detectImportPackageFromDir, renderConfigFileContent } from "@stackframe/stack-shared/dist/config-rendering";

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
    .requiredOption("--config-file <path>", "Path to write config file (.ts)")
    .option("--overwrite", "Overwrite an existing config file")
    .action(async (opts) => {
      const flags = program.opts();
      const auth = resolveAuth(flags);
      const project = await getAdminProject(auth);

      const configOverride = await project.getConfigOverride("branch");
      const filePath = path.resolve(opts.configFile);
      const ext = path.extname(filePath);

      if (ext !== ".ts") {
        throw new CliError("Config file must have a .ts extension. Typed config files require TypeScript.");
      }

      if (fs.existsSync(filePath) && !opts.overwrite) {
        throw new CliError(`Config file already exists at ${filePath}. Stage or back up your changes, then re-run with --overwrite.`);
      }

      const importPackage = detectImportPackageFromDir(path.dirname(filePath));
      const content = renderConfigFileContent(configOverride, importPackage);

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

      const { createJiti } = await import("jiti");
      const jiti = createJiti(import.meta.url);
      const configModule: { config?: unknown } = await jiti.import(filePath);

      const config = configModule.config;
      if (!isPlainObject(config)) {
        const examplePkg = detectImportPackageFromDir(path.dirname(filePath)) ?? "@stackframe/js";
        throw new CliError(`Config file must export a plain \`config\` object. Example: import type { StackConfig } from "${examplePkg}"; export const config: StackConfig = { ... };`);
      }

      await project.replaceConfigOverride("branch", config);
      console.log("Config pushed successfully.");
    });
}
