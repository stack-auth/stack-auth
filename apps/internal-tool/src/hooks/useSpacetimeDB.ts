import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { useEffect, useState, useRef } from "react";
import type { Identity } from "spacetimedb";
import { envOrDevDefault } from "../lib/env";
import { DbConnection, type ErrorContext, type EventContext, type SubscriptionEventContext } from "../module_bindings";
import type { AiQueryLogRow, McpCallLogRow, PublishedQaRow } from "../types";

export type EnsureEnrolled = (identity: Identity) => Promise<void>;

let cachedConfig: { host: string, dbName: string, tokenKey: string } | null = null;
function getConfig() {
  if (cachedConfig) return cachedConfig;
  const host = envOrDevDefault(process.env.NEXT_PUBLIC_SPACETIMEDB_HOST, "ws://localhost:8139", "NEXT_PUBLIC_SPACETIMEDB_HOST");
  if (process.env.NODE_ENV !== "development" && !host.startsWith("wss://")) {
    throw new Error("NEXT_PUBLIC_SPACETIMEDB_HOST must use wss:// in production");
  }
  const dbName = envOrDevDefault(process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME, "stack-auth-llm", "NEXT_PUBLIC_SPACETIMEDB_DB_NAME");
  cachedConfig = { host, dbName, tokenKey: `spacetimedb_${host}/${dbName}/auth_token` };
  return cachedConfig;
}

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

type ConnectionState = "connecting" | "connected" | "error";

type TableBinding<Row extends { id: bigint }> = {
  tableName: string,
  iter: (ctx: SubscriptionEventContext) => Iterable<Row>,
  onInsert: (conn: DbConnection, cb: (row: Row) => void) => void,
  onDelete: (conn: DbConnection, cb: (row: Row) => void) => void,
};

// Each hook call opens its own DbConnection. With only two subscriptions
// per reviewer (mcp_call_log + ai_query_log), the extra WS handshake is
// negligible, and keeping hooks self-contained avoids a shared-connection
// context with subscription refcounting. Revisit if subscription count grows.
function useTableSubscription<Row extends { id: bigint }>(
  binding: TableBinding<Row>,
  ensureEnrolled?: EnsureEnrolled,
) {
  const [rows, setRows] = useState<Row[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const connRef = useRef<DbConnection | null>(null);
  const ensureEnrolledRef = useRef(ensureEnrolled);
  useEffect(() => {
    ensureEnrolledRef.current = ensureEnrolled;
  }, [ensureEnrolled]);

  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const query = `SELECT * FROM ${binding.tableName}`;

    function retry() {
      if (cancelled) return;
      retryCount++;
      if (retryCount > MAX_RETRIES) {
        captureError("spacetimedb-connect-max-retries", new Error(`Gave up connecting to ${binding.tableName} after ${MAX_RETRIES} retries`));
        setConnectionState("error");
        return;
      }
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!cancelled) {
          connect();
        }
      }, RETRY_DELAY_MS);
    }

    function connect() {
      const config = getConfig();
      const conn = DbConnection.builder()
        .withUri(config.host)
        .withDatabaseName(config.dbName)
        .withToken(localStorage.getItem(config.tokenKey) || undefined)
        .onConnect((connInstance: DbConnection, identity: Identity, token: string) => {
          if (cancelled) return;
          retryCount = 0;
          localStorage.setItem(config.tokenKey, token);
          connRef.current = connInstance;

          const startSubscription = () => {
            if (cancelled) return;
            connInstance.subscriptionBuilder()
              .onApplied((ctx: SubscriptionEventContext) => {
                if (cancelled) return;
                const initial: Row[] = [];
                for (const row of binding.iter(ctx)) {
                  initial.push(row);
                }
                initial.sort((a, b) => Number(b.id - a.id));
                setRows(initial);
                setConnectionState("connected");
              })
              .onError((ctx: ErrorContext) => {
                if (cancelled) return;
                captureError("spacetimedb-subscription", ctx);
                setConnectionState("error");
              })
              .subscribe(query);
          };

          const enrollFn = ensureEnrolledRef.current;
          if (enrollFn) {
            enrollFn(identity).then(
              () => startSubscription(),
              (err) => {
                captureError("spacetimedb-enroll", err);
                setConnectionState("error");
              },
            );
          } else {
            startSubscription();
          }

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
          if (cancelled) return;
          const message = err instanceof Error ? err.message : "";
          const looksLikeAuthFailure = /unauthor|verify token|401/i.test(message);
          if (looksLikeAuthFailure) {
            localStorage.removeItem(config.tokenKey);
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
  tableName: "my_visible_mcp_call_log",
  iter: (ctx) => ctx.db.myVisibleMcpCallLog.iter(),
  onInsert: (conn, cb) => {
    conn.db.myVisibleMcpCallLog.onInsert((_ctx: EventContext, row: McpCallLogRow) => cb(row));
  },
  onDelete: (conn, cb) => {
    conn.db.myVisibleMcpCallLog.onDelete((_ctx: EventContext, row: McpCallLogRow) => cb(row));
  },
};

const aiQueryBinding: TableBinding<AiQueryLogRow> = {
  tableName: "my_visible_ai_query_log",
  iter: (ctx) => ctx.db.myVisibleAiQueryLog.iter(),
  onInsert: (conn, cb) => {
    conn.db.myVisibleAiQueryLog.onInsert((_ctx: EventContext, row: AiQueryLogRow) => cb(row));
  },
  onDelete: (conn, cb) => {
    conn.db.myVisibleAiQueryLog.onDelete((_ctx: EventContext, row: AiQueryLogRow) => cb(row));
  },
};

const publishedQaBinding: TableBinding<PublishedQaRow> = {
  tableName: "published_qa",
  iter: (ctx) => ctx.db.publishedQa.iter(),
  onInsert: (conn, cb) => {
    conn.db.publishedQa.onInsert((_ctx: EventContext, row: PublishedQaRow) => cb(row));
  },
  onDelete: (conn, cb) => {
    conn.db.publishedQa.onDelete((_ctx: EventContext, row: PublishedQaRow) => cb(row));
  },
};

export function useMcpCallLogs(ensureEnrolled?: EnsureEnrolled) {
  return useTableSubscription(mcpBinding, ensureEnrolled);
}

export function useAiQueryLogs(ensureEnrolled?: EnsureEnrolled) {
  return useTableSubscription(aiQueryBinding, ensureEnrolled);
}

/**
 * Public — no enrollment required. Backed by the `published_qa` anonymousView,
 * which returns only rows reviewers have explicitly published. Safe to call
 * from unauthenticated pages.
 */
export function usePublishedQa() {
  return useTableSubscription(publishedQaBinding);
}
