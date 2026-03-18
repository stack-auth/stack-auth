import { renderConfigFileContent } from "@stackframe/stack-shared/dist/config-rendering";
import { CliError } from "./errors";

export function renderConfigFile(config: unknown): string {
  try {
    return renderConfigFileContent(config);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : "Config file content is invalid. The file must export a 'config' object.");
  }
}
