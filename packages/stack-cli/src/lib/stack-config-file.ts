import { renderConfigFileContent } from "@stackframe/stack-shared/dist/config-rendering";

export function renderConfigFile(config: unknown): string {
  return renderConfigFileContent(config);
}
