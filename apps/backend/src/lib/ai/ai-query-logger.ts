import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { getConnection } from "./mcp-logger";
import type { LogAiQueryParams } from "./spacetimedb-bindings/types/reducers";

export type AiQueryLogEntry = Omit<LogAiQueryParams, "token">;

export async function logAiQuery(entry: AiQueryLogEntry): Promise<void> {
  const conn = await getConnection();
  if (!conn) return;
  const token = getEnvVariable("STACK_MCP_LOG_TOKEN");
  await conn.reducers.logAiQuery({ token, ...entry });
}
