import { useEffect, useState, useRef } from "react";
import { DbConnection, type EventContext, type SubscriptionEventContext } from "../module_bindings";
import type { AiQueryLogRow, McpCallLogRow } from "../types";

const IS_DEV = process.env.NODE_ENV === "development";
const PLACEHOLDER = "REPLACE_ME";
const rawHost = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST;
const rawDbName = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME;
function resolveEnv(raw: string | undefined, devDefault: string, name: string): string {
  if (raw && raw !== PLACEHOLDER) return raw;
  if (IS_DEV) return devDefault;
  throw new Error(`${name} is not configured. Set it in .env.local or hosting platform env.`);
}
const HOST = resolveEnv(rawHost, "ws://localhost:8139", "NEXT_PUBLIC_SPACETIMEDB_HOST");
const DB_NAME = resolveEnv(rawDbName, "stack-auth-llm", "NEXT_PUBLIC_SPACETIMEDB_DB_NAME");
const TOKEN_KEY = `spacetimedb_${HOST}/${DB_NAME}/auth_token`;

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

type TableBinding<Row extends { id: bigint }> = {
  tableName: string,
  iter: (ctx: SubscriptionEventContext) => Iterable<Row>,
  onInsert: (conn: DbConnection, cb: (row: Row) => void) => void,
  onDelete: (conn: DbConnection, cb: (row: Row) => void) => void,
};

function useTableSubscription<Row extends { id: bigint }>(
  binding: TableBinding<Row>,
) {
  const [rows, setRows] = useState<Row[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const connRef = useRef<DbConnection | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const query = `SELECT * FROM ${binding.tableName}`;

    console.log("[SpacetimeDB]", query, "connecting to", HOST, "db:", DB_NAME);

    function retry() {
      if (cancelled) return;
      retryCount++;
      if (retryCount > MAX_RETRIES) {
        console.error("[SpacetimeDB] Max retries reached for", query);
        setConnectionState("error");
        return;
      }
      console.log(`[SpacetimeDB] Retrying in ${RETRY_DELAY_MS}ms (attempt ${retryCount}/${MAX_RETRIES})...`);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!cancelled) {
          connect();
        }
      }, RETRY_DELAY_MS);
    }

    function connect() {
      const conn = DbConnection.builder()
        .withUri(HOST)
        .withDatabaseName(DB_NAME)
        .withToken(localStorage.getItem(TOKEN_KEY) || undefined)
        .onConnect((connInstance: DbConnection, _identity: unknown, token: string) => {
          if (cancelled) return;
          retryCount = 0;
          localStorage.setItem(TOKEN_KEY, token);
          connRef.current = connInstance;

          connInstance.subscriptionBuilder()
            .onApplied((ctx: SubscriptionEventContext) => {
              if (cancelled) return;
              const initial: Row[] = [];
              for (const row of binding.iter(ctx)) {
                initial.push(row);
              }
              initial.sort((a, b) => Number(b.id - a.id));
              console.log(`[SpacetimeDB] ${query} loaded ${initial.length} rows`);
              setRows(initial);
              setConnectionState("connected");
            })
            .subscribe(query);

          binding.onInsert(connInstance, (row) => {
            if (cancelled) return;
            setRows(prev => {
              const existing = prev.findIndex(r => r.id === row.id);
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = row;
                return updated;
              }
              return [row, ...prev];
            });
          });

          binding.onDelete(connInstance, (row) => {
            if (cancelled) return;
            setRows(prev => prev.filter(r => r.id !== row.id));
          });
        })
        .onConnectError((_ctx: unknown, err: unknown) => {
          console.error("[SpacetimeDB] Connection error:", err);
          const storedToken = localStorage.getItem(TOKEN_KEY);
          if (storedToken) {
            console.log("[SpacetimeDB] Clearing stale token");
            localStorage.removeItem(TOKEN_KEY);
          }
          retry();
        })
        .build();

      connRef.current = conn;
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (connRef.current) {
        connRef.current.disconnect();
        connRef.current = null;
      }
    };
  }, [binding]);

  return { rows, connectionState };
}

const mcpBinding: TableBinding<McpCallLogRow> = {
  tableName: "mcp_call_log",
  iter: (ctx) => ctx.db.mcpCallLog.iter(),
  onInsert: (conn, cb) => {
    conn.db.mcpCallLog.onInsert((_ctx: EventContext, row: McpCallLogRow) => cb(row));
  },
  onDelete: (conn, cb) => {
    conn.db.mcpCallLog.onDelete((_ctx: EventContext, row: McpCallLogRow) => cb(row));
  },
};

const aiQueryBinding: TableBinding<AiQueryLogRow> = {
  tableName: "ai_query_log",
  iter: (ctx) => ctx.db.aiQueryLog.iter(),
  onInsert: (conn, cb) => {
    conn.db.aiQueryLog.onInsert((_ctx: EventContext, row: AiQueryLogRow) => cb(row));
  },
  onDelete: (conn, cb) => {
    conn.db.aiQueryLog.onDelete((_ctx: EventContext, row: AiQueryLogRow) => cb(row));
  },
};

export function useMcpCallLogs() {
  return useTableSubscription(mcpBinding);
}

export function useAiQueryLogs() {
  return useTableSubscription(aiQueryBinding);
}
