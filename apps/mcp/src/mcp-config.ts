import { getEnvVariable } from "@hexclave/shared/dist/utils/env";

export type McpConfig = {
  apiUrl: string,
  projectId: string,
  publishableKey: string,
  resourceUri: string,
  serverKey: string,
};

function requiredServerEnv(name: string): string {
  return getEnvVariable(name).trim();
}

let cachedConfig: McpConfig | undefined;

export function getMcpConfig(): McpConfig {
  if (cachedConfig === undefined) {
    cachedConfig = {
      apiUrl: requiredServerEnv("HEXCLAVE_MCP_API_URL").replace(/\/$/, ""),
      projectId: requiredServerEnv("HEXCLAVE_MCP_PROJECT_ID"),
      publishableKey: requiredServerEnv("HEXCLAVE_MCP_PUBLISHABLE_KEY"),
      resourceUri: requiredServerEnv("HEXCLAVE_MCP_RESOURCE_URI"),
      serverKey: requiredServerEnv("HEXCLAVE_MCP_SERVER_KEY"),
    };
  }
  return cachedConfig;
}
