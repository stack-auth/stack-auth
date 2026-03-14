import { isValidConfig, normalize } from "@stackframe/stack-shared/dist/config/format";
import { CliError } from "./errors.js";

const stackConfigImportStatement = 'import { defineStackConfig } from "@stackframe/stack-shared/config";';

export function renderConfigFile(config: unknown): string {
  if (!isValidConfig(config)) {
    throw new CliError("Config file content is invalid.");
  }

  const normalizedConfig = normalize(config, {
    onDotIntoNonObject: "ignore",
    onDotIntoNull: "empty-object",
  });
  return `${stackConfigImportStatement}\n\nexport const config = defineStackConfig(${JSON.stringify(normalizedConfig, null, 2)});\n`;
}
