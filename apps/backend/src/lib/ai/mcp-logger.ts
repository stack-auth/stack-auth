import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { DbConnection } from "./spacetimedb-bindings";
import type { LogMcpCallParams } from "./spacetimedb-bindings/types/reducers";

export type McpLogEntry = Omit<LogMcpCallParams, "token">;

let connectionPromise: Promise<DbConnection> | null = null;

export async function getConnection(): Promise<DbConnection | null> {
  const uri = getEnvVariable("STACK_SPACETIMEDB_URI", "");
  if (!uri) {
    return null;
  }

  if (!connectionPromise) {
    connectionPromise = new Promise<DbConnection>((resolve, reject) => {
      DbConnection.builder()
        .withUri(uri)
        .withDatabaseName(getEnvVariable("STACK_SPACETIMEDB_DB_NAME"))
        .onConnect((connInstance) => {
          connInstance.subscriptionBuilder()
            .onApplied(() => {
              resolve(connInstance);
            })
            .subscribe(["SELECT * FROM mcp_call_log", "SELECT * FROM ai_query_log"]);
        })
        .onConnectError((_: unknown, err: Error) => {
          captureError("mcp-logger", err);
          connectionPromise = null;
          reject(err);
        })
        .build();
    });
  }

  return await connectionPromise;
}

export async function getConnectionOrThrow(): Promise<DbConnection> {
  const conn = await getConnection();
  if (!conn) {
    throw new StackAssertionError("SpacetimeDB connection unavailable");
  }
  return conn;
}

export async function logMcpCall(entry: McpLogEntry): Promise<void> {
  const conn = await getConnection();
  if (!conn) {
    return;
  }

  const token = getEnvVariable("STACK_MCP_LOG_TOKEN");
  await conn.reducers.logMcpCall({
    token,
    ...entry,
  });
}
