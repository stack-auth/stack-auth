import { useEffect, useState, useRef } from "react";
import { DbConnection, type EventContext, type SubscriptionEventContext } from "../module_bindings";
import type { McpCallLogRow } from "../types";

const HOST = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST ?? "";
const DB_NAME = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME ?? "";
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
      setTimeout(() => {
        if (!cancelled) {
          connect().catch(() => {});
        }
      }, RETRY_DELAY_MS);
    }

    async function connect() {
      try {
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
            // Clear stale token if present
            const storedToken = localStorage.getItem(TOKEN_KEY);
            if (storedToken) {
              console.log("[SpacetimeDB] Clearing stale token");
              localStorage.removeItem(TOKEN_KEY);
            }
            retry();
          })
          .build();

        connRef.current = conn;
      } catch (err) {
        console.error("[SpacetimeDB] Failed to build connection:", err);
        retry();
      }
    }

    connect().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return { rows, connectionState };
}
