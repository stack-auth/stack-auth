import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useEffect, useState, useRef } from "react";
import { DbConnection, type ErrorContext, type EventContext, type SubscriptionEventContext } from "../module_bindings";
import type { AiQueryLogRow, McpCallLogRow, PublishedQaRow, QaEntriesRow } from "../types";

/**
 * Returns a fresh SpacetimeDB token (minted under the internal tool's own OIDC
 * issuer) for the signed-in user. SpacetimeDB validates it via OIDC discovery;
 * the module authorizes on issuer + audience only, so any valid member token
 * grants full read/write.
 */
export type GetSpacetimeToken = () => Promise<string>;

const PLACEHOLDER_ENV_VALUE = "REPLACE_ME";

function requireEnv(value: string | undefined, name: string): string {
  if (value == null || value === "" || value === PLACEHOLDER_ENV_VALUE) {
    throw new Error(`${name} is not configured. Set it in apps/internal-tool/.env.development or your local env.`);
  }
  return value;
}

let cachedConfig: { host: string, dbName: string } | null = null;
function getConfig() {
  if (cachedConfig) return cachedConfig;
  const host = requireEnv(process.env.NEXT_PUBLIC_SPACETIMEDB_HOST, "NEXT_PUBLIC_SPACETIMEDB_HOST");
  if (process.env.NODE_ENV !== "development" && !host.startsWith("wss://")) {
    throw new Error("NEXT_PUBLIC_SPACETIMEDB_HOST must use wss:// in production");
  }
  const dbName = requireEnv(process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME, "NEXT_PUBLIC_SPACETIMEDB_DB_NAME");
  cachedConfig = { host, dbName };
  return cachedConfig;
}

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;
// Access tokens live ~10min and `withToken` is fixed at build() time, so tear
// down and reconnect with a fresh token before the current one expires.
const TOKEN_RECONNECT_INTERVAL_MS = 8 * 60 * 1000;

type ConnectionState = "connecting" | "connected" | "error";

function formatUnknownError(value: unknown, fallback: string, depth = 0): string {
  if (value instanceof Error) {
    return value.message !== "" ? value.message : value.name;
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value == null) return fallback;
  if (typeof value !== "object") return fallback;

  for (const property of ["message", "error", "reason", "statusText"]) {
    const propertyValue = Reflect.get(value, property);
    if (typeof propertyValue === "string" && propertyValue !== "") {
      return propertyValue;
    }
  }

  if (depth < 2) {
    for (const property of ["error", "cause", "event"]) {
      const propertyValue: unknown = Reflect.get(value, property);
      if (propertyValue != null && propertyValue !== value) {
        const nestedMessage = formatUnknownError(propertyValue, "", depth + 1);
        if (nestedMessage !== "") {
          return nestedMessage;
        }
      }
    }
  }

  try {
    const serialized = JSON.stringify(value, (_key, nestedValue: unknown) => (
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
    ));
    if (serialized !== "{}") {
      return serialized;
    }
  } catch {
    // Fall through to the best generic representation below.
  }

  const stringified = String(value);
  return stringified !== "[object Object]" ? stringified : fallback;
}

type TableBinding<Row extends { id: bigint }> = {
  tableName: string,
  iter: (ctx: SubscriptionEventContext) => Iterable<Row>,
  onInsert: (conn: DbConnection, cb: (row: Row) => void) => void,
  onDelete: (conn: DbConnection, cb: (row: Row) => void) => void,
  onUpdate?: (conn: DbConnection, cb: (row: Row) => void) => void,
};

function useTableSubscription<Row extends { id: bigint }>(
  binding: TableBinding<Row>,
  getToken?: GetSpacetimeToken,
  requireAuth = false,
) {
  const [rows, setRows] = useState<Row[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [connectionErrorMessage, setConnectionErrorMessage] = useState<string | null>(null);
  const [conn, setConn] = useState<DbConnection | null>(null);
  const connRef = useRef<DbConnection | null>(null);

  useEffect(() => {
    if (requireAuth && !getToken) {
      setRows([]);
      setConn(null);
      setConnectionState("connecting");
      return;
    }

    let cancelled = false;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastConnectionErrorMessage: string | null = null;
    const query = `SELECT * FROM ${binding.tableName}`;

    function retry() {
      if (cancelled) return;
      retryCount++;
      if (retryCount > MAX_RETRIES) {
        const message = lastConnectionErrorMessage == null
          ? `Gave up connecting to ${binding.tableName} after ${MAX_RETRIES} retries`
          : `Gave up connecting to ${binding.tableName} after ${MAX_RETRIES} retries. Last error: ${lastConnectionErrorMessage}`;
        captureError("spacetimedb-connect-max-retries", new Error(message));
        setConnectionErrorMessage(message);
        setConnectionState("error");
        return;
      }
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!cancelled) {
          runAsynchronously(() => connect());
        }
      }, RETRY_DELAY_MS);
    }

    function scheduleTokenReconnect() {
      if (!getToken || reconnectTimer != null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (cancelled) return;
        // Proactive teardown + reconnect: fetches a fresh access token in
        // connect(). Rows are kept until the new subscription applies, so the
        // UI doesn't flicker.
        connRef.current?.disconnect();
        connRef.current = null;
        runAsynchronously(() => connect());
      }, TOKEN_RECONNECT_INTERVAL_MS);
    }

    async function connect() {
      const config = getConfig();
      let token: string | null = null;
      if (getToken) {
        try {
          token = await getToken();
        } catch (err) {
          if (cancelled) return;
          lastConnectionErrorMessage = formatUnknownError(err, "Failed to get Stack Auth access token");
          setConnectionErrorMessage(lastConnectionErrorMessage);
          captureError("spacetimedb-access-token", err);
          retry();
          return;
        }
      }
      if (cancelled) return;

      const builder = DbConnection.builder()
        .withUri(config.host)
        .withDatabaseName(config.dbName)
        .onConnect((connInstance: DbConnection, _identity, _token) => {
          if (cancelled) return;
          retryCount = 0;
          connRef.current = connInstance;
          setConn(connInstance);
          setConnectionErrorMessage(null);
          scheduleTokenReconnect();

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
                const message = formatUnknownError(ctx, "SpacetimeDB subscription error");
                lastConnectionErrorMessage = message;
                captureError("spacetimedb-subscription", ctx);
                setConnectionErrorMessage(message);
                setConnectionState("error");
              })
              .subscribe(query);
          };

          startSubscription();

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

          binding.onUpdate?.(connInstance, (row) => {
            if (cancelled) return;
            setRows(prev => {
              const idx = prev.findIndex(r => r.id === row.id);
              if (idx < 0) return [row, ...prev];
              const updated = [...prev];
              updated[idx] = row;
              return updated;
            });
          });
        })
        .onConnectError((_ctx: unknown, err: unknown) => {
          if (cancelled) return;
          const message = formatUnknownError(err, "SpacetimeDB connection error");
          lastConnectionErrorMessage = message;
          setConnectionErrorMessage(message);
          captureError("spacetimedb-connect", err);
          retry();
        });
      if (token != null) {
        builder.withToken(token);
      }
      const newConn = builder.build();

      connRef.current = newConn;
    }

    runAsynchronously(() => connect());

    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (connRef.current) {
        connRef.current.disconnect();
        connRef.current = null;
      }
      setConn(null);
    };
  }, [binding, getToken, requireAuth]);

  return { rows, connectionState, connectionErrorMessage, conn };
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
  onUpdate: (conn, cb) => {
    conn.db.myVisibleMcpCallLog.onUpdate((_ctx: EventContext, _old: McpCallLogRow, row: McpCallLogRow) => cb(row));
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
  onUpdate: (conn, cb) => {
    conn.db.myVisibleAiQueryLog.onUpdate((_ctx: EventContext, _old: AiQueryLogRow, row: AiQueryLogRow) => cb(row));
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

const qaEntriesBinding: TableBinding<QaEntriesRow> = {
  tableName: "my_visible_qa_entries",
  iter: (ctx) => ctx.db.myVisibleQaEntries.iter(),
  onInsert: (conn, cb) => {
    conn.db.myVisibleQaEntries.onInsert((_ctx: EventContext, row: QaEntriesRow) => cb(row));
  },
  onDelete: (conn, cb) => {
    conn.db.myVisibleQaEntries.onDelete((_ctx: EventContext, row: QaEntriesRow) => cb(row));
  },
  onUpdate: (conn, cb) => {
    conn.db.myVisibleQaEntries.onUpdate((_ctx: EventContext, _old: QaEntriesRow, row: QaEntriesRow) => cb(row));
  },
};

export function useMcpCallLogs(getToken?: GetSpacetimeToken) {
  return useTableSubscription(mcpBinding, getToken, true);
}

export function useAiQueryLogs(getToken?: GetSpacetimeToken) {
  return useTableSubscription(aiQueryBinding, getToken, true);
}

/**
 * Public — no auth required. Backed by the `published_qa` anonymousView,
 * which returns only rows reviewers have explicitly published. Safe to call
 * from unauthenticated pages.
 */
export function usePublishedQa() {
  return useTableSubscription(publishedQaBinding);
}

/**
 * Reviewer-only. Subscribes to the curated Q&A entries table (separate from
 * mcp_call_log telemetry). Use this for the editorial surface — every row
 * here is a Q&A pair, either tied to a real MCP call (sourceMcpCorrelationId
 * non-null) or a manual entry (null).
 */
export function useQaEntries(getToken?: GetSpacetimeToken) {
  return useTableSubscription(qaEntriesBinding, getToken, true);
}
