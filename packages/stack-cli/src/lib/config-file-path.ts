import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { CliError } from "./errors.js";

export function resolveConfigFilePathOption(inputPath: string, options?: {
  mustExist?: boolean,
  optionName?: string,
}): string {
  const resolved = resolve(inputPath);
  const optionName = options?.optionName ?? "--config-file";

  if (!existsSync(resolved)) {
    if (options?.mustExist === true) {
      throw new CliError(`Config file not found: ${resolved}`);
    }
    return resolved;
  }

  const stat = statSync(resolved);
  if (stat.isDirectory()) {
    throw new CliError(`${optionName} must point to a config file, but got a directory: ${resolved}`);
  }
  if (!stat.isFile()) {
    throw new CliError(`${optionName} must point to a regular config file: ${resolved}`);
  }

  return resolved;
}
