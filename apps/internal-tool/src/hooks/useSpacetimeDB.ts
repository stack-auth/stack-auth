import { useEffect, useState, useRef } from "react";
import { DbConnection, type EventContext, type SubscriptionEventContext } from "../module_bindings";
import type { McpCallLogRow } from "../types";

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

export function useMcpCallLogs() {
  const [rows, setRows] = useState<McpCallLogRow[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const connRef = useRef<DbConnection | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    console.log("[SpacetimeDB] Connecting to", HOST, "db:", DB_NAME);

    function retry() {
      if (cancelled) return;
      retryCount++;
      if (retryCount > MAX_RETRIES) {
        console.error("[SpacetimeDB] Max retries reached");
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
          console.log("[SpacetimeDB] Connected successfully");
          retryCount = 0;
          localStorage.setItem(TOKEN_KEY, token);
          connRef.current = connInstance;

          connInstance.subscriptionBuilder()
            .onApplied((ctx: SubscriptionEventContext) => {
              if (cancelled) return;
              const initialRows: McpCallLogRow[] = [];
              for (const row of ctx.db.mcpCallLog.iter()) {
                initialRows.push(row);
              }
              initialRows.sort((a, b) => Number(b.id - a.id));
              console.log("[SpacetimeDB] Loaded", initialRows.length, "rows");
              setRows(initialRows);
              setConnectionState("connected");
            })
            .subscribe(`SELECT * FROM mcp_call_log`);

          connInstance.db.mcpCallLog.onInsert((_ctx: EventContext, row: McpCallLogRow) => {
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

          connInstance.db.mcpCallLog.onDelete((_ctx: EventContext, row: McpCallLogRow) => {
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
  }, []);

  return { rows, connectionState };
}
