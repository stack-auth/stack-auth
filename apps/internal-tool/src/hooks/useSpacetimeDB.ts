import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useEffect, useState, useRef } from "react";
import { createPendingCallRegistry } from "../lib/pending-call-registry";
import { DbConnection, type ErrorContext, type EventContext } from "../module_bindings";
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

// After this many consecutive failures the error banner is shown (and the
// error captured once), but reconnection attempts continue forever with capped
// exponential backoff: this is a long-lived dashboard, and a transient outage
// (dev-server rebuild, server restart, laptop sleep, network blip) must not
// permanently kill the page until someone manually reloads it.
const RETRIES_BEFORE_ERROR_STATE = 5;
const RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 30_000;
// Reconnect with a fresh token well before the current one expires
// (`withToken` is fixed at build() time, so reconnecting is the only way to
// rotate it). The token TTL (30min, see lib/server/spacetimedb-token.ts) is
// deliberately much longer than this interval: browsers throttle timers in
// backgrounded tabs, so this can fire late — the wide margin keeps the
// server-side session row valid (and the my_visible_* views non-empty, which
// would otherwise delete every row out from under the subscription) even when
// several refresh cycles are delayed.
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

// The row callbacks intentionally take no arguments: React state is always
// rebuilt from the SDK's table cache (see resyncFromCache below), never
// patched row-by-row from event payloads.
type TableBinding<Row extends { id: bigint }> = {
  tableName: string,
  iter: (conn: DbConnection) => Iterable<Row>,
  onInsert: (conn: DbConnection, cb: () => void) => void,
  onDelete: (conn: DbConnection, cb: () => void) => void,
  onUpdate?: (conn: DbConnection, cb: () => void) => void,
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
  // One registry per hook instance, shared across connection generations:
  // every teardown force-rejects whatever is still in flight on the old
  // connection (see callReducer below for why the SDK can't do this itself).
  const [pendingCalls] = useState(createPendingCallRegistry);

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
    // Every connection built in this effect generation that hasn't been
    // disposed yet. Old connections are kept alive until their replacement's
    // subscription has applied (make-before-break), so the UI never blanks
    // during a token refresh; this set lets the winner (and the unmount
    // cleanup) dispose of the rest.
    const liveConns = new Set<DbConnection>();
    // Mirrors the length of the last rows array pushed to React state; used to
    // detect a non-empty view collapsing to empty (see resyncFromCache).
    let lastRenderedRowCount = 0;
    // True while a session-lapse-triggered reconnect is pending, so repeated
    // empty resyncs don't stack up reconnect attempts. Reset when any
    // subscription applies.
    let sessionRefreshInFlight = false;
    const query = `SELECT * FROM ${binding.tableName}`;

    const closedConnError = () => new Error("SpacetimeDB connection was closed while the call was in flight. The change may or may not have been applied — check the list and retry if needed.");

    function retry() {
      if (cancelled || retryTimer != null) return;
      retryCount++;
      if (retryCount >= RETRIES_BEFORE_ERROR_STATE) {
        const message = lastConnectionErrorMessage == null
          ? `Failed to connect to ${binding.tableName} after ${retryCount} attempts (still retrying)`
          : `Failed to connect to ${binding.tableName} after ${retryCount} attempts (still retrying). Last error: ${lastConnectionErrorMessage}`;
        if (retryCount === RETRIES_BEFORE_ERROR_STATE) {
          captureError("spacetimedb-connect-retries", new Error(message));
        }
        setConnectionErrorMessage(message);
        setConnectionState("error");
      }
      const delay = Math.min(RETRY_DELAY_MS * 2 ** Math.min(retryCount - 1, 5), MAX_RETRY_DELAY_MS);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!cancelled) {
          runAsynchronously(() => connect());
        }
      }, delay);
    }

    function scheduleTokenReconnect() {
      if (!getToken || reconnectTimer != null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (cancelled) return;
        // Make-before-break: the current connection keeps serving rows until
        // the replacement's subscription has applied (see onApplied below).
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

      let thisConn: DbConnection | null = null;
      const builder = DbConnection.builder()
        .withUri(config.host)
        .withDatabaseName(config.dbName)
        .onConnect((connInstance: DbConnection, _identity, _token) => {
          if (cancelled) return;
          if (connRef.current !== connInstance) {
            // A newer connect() superseded this attempt while it was still in
            // flight; let the winner drive the UI and dispose of this one.
            connInstance.disconnect();
            liveConns.delete(connInstance);
            return;
          }
          retryCount = 0;
          setConn(connInstance);
          setConnectionErrorMessage(null);
          scheduleTokenReconnect();

          // Our tables are backed by function views, and view row types carry
          // no primary key on the client. For PK-less tables the SpacetimeDB
          // SDK never emits `update` events — a server-side row update arrives
          // as insert(newValue) + delete(oldValue), with inserts processed
          // FIRST. Mirroring those events into React state keyed by `id` is
          // therefore wrong: the insert replaces the row in place, then the
          // delete (same `id`, old value) removes it entirely, so every row
          // silently disappeared from the UI the moment it was updated (e.g.
          // when the OpenRouter usage refinement landed a few seconds after
          // each AI call). The SDK's own table cache refcounts by full row
          // value and stays correct through all of this, so we treat it as the
          // source of truth and rebuild React state from it on every event.
          const snapshotFromCache = () => {
            const all = Array.from(binding.iter(connInstance));
            all.sort((a, b) => Number(b.id - a.id));
            return all;
          };

          const applyRows = (all: Row[]) => {
            lastRenderedRowCount = all.length;
            setRows(all);
          };

          const resyncFromCache = () => {
            // The connRef guard freezes rows sourced from a superseded
            // connection: once a replacement has been built, only ITS cache
            // may drive the UI, so a dying connection's teardown events can't
            // blank the table.
            if (cancelled || connRef.current !== connInstance) return;
            const all = snapshotFromCache();
            // A non-empty view collapsing to empty mid-connection is (almost
            // always) NOT real data loss: it's the server-side session row
            // expiring under a still-open WebSocket — the module's
            // my_visible_* views return [] for sessionless subscribers and
            // SpacetimeDB then deletes every row under the subscription, and
            // no further events ever arrive on that connection. (Verified
            // against a local instance by subscribing with a short-exp token:
            // the session_gc sweep produced a delete-all, then silence.)
            // Keep showing the last-known rows and reconnect with a fresh
            // token instead; the new subscription's onApplied below is
            // authoritative and will set the true state — including a
            // genuinely emptied table, which costs one spurious reconnect.
            if (all.length === 0 && lastRenderedRowCount > 0) {
              if (!sessionRefreshInFlight) {
                sessionRefreshInFlight = true;
                runAsynchronously(() => connect());
              }
              return;
            }
            applyRows(all);
          };

          const startSubscription = () => {
            if (cancelled) return;
            connInstance.subscriptionBuilder()
              .onApplied(() => {
                if (cancelled || connRef.current !== connInstance) return;
                sessionRefreshInFlight = false;
                // The new subscription is live — only now is it safe to drop
                // older connections without the UI ever missing rows.
                let droppedAny = false;
                for (const old of liveConns) {
                  if (old !== connInstance) {
                    old.disconnect();
                    liveConns.delete(old);
                    droppedAny = true;
                  }
                }
                if (droppedAny) {
                  pendingCalls.rejectAll(closedConnError());
                }
                // Unlike event-driven resyncs, a fresh subscription's snapshot
                // is authoritative even when empty (the session was just
                // re-established, so [] here means the table really is empty).
                applyRows(snapshotFromCache());
                setConnectionState("connected");
              })
              .onError((ctx: ErrorContext) => {
                if (cancelled || connRef.current !== connInstance) return;
                const message = formatUnknownError(ctx, "SpacetimeDB subscription error");
                lastConnectionErrorMessage = message;
                captureError("spacetimedb-subscription", ctx);
                setConnectionErrorMessage(message);
                setConnectionState("error");
              })
              .subscribe(query);
          };

          startSubscription();

          // Callbacks within one transaction batch fire after the cache has
          // fully absorbed the batch, so each resync sees a consistent
          // snapshot; redundant resyncs collapse in React's render batching.
          binding.onInsert(connInstance, resyncFromCache);
          binding.onDelete(connInstance, resyncFromCache);
          // Never fires for PK-less view tables today (see above), but kept so
          // rows stay correct if a view ever regains primary-key metadata.
          binding.onUpdate?.(connInstance, resyncFromCache);
        })
        .onConnectError((_ctx: unknown, err: unknown) => {
          if (cancelled) return;
          if (thisConn != null) liveConns.delete(thisConn);
          const message = formatUnknownError(err, "SpacetimeDB connection error");
          lastConnectionErrorMessage = message;
          setConnectionErrorMessage(message);
          captureError("spacetimedb-connect", err);
          retry();
        })
        .onDisconnect(() => {
          // Fires when an ESTABLISHED connection ends. Intentional teardowns
          // (superseded generation, unmount) are filtered by the guards below;
          // what remains is the active connection dying unexpectedly (server
          // restart, network drop, laptop wake) — reconnect right away so the
          // dashboard self-heals instead of sitting dead until a reload.
          if (thisConn != null) liveConns.delete(thisConn);
          if (cancelled || connRef.current !== thisConn) return;
          pendingCalls.rejectAll(closedConnError());
          setConnectionState("connecting");
          retry();
        });
      if (token != null) {
        builder.withToken(token);
      }
      const newConn = builder.build();
      thisConn = newConn;
      liveConns.add(newConn);
      // Assigned at build time (not connect time) so that from this moment on,
      // the previous connection's events are frozen out of the UI and the
      // handlers above can tell whether they belong to the newest generation.
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
      for (const c of liveConns) {
        c.disconnect();
      }
      liveConns.clear();
      connRef.current = null;
      setConn(null);
      pendingCalls.rejectAll(closedConnError());
    };
  }, [binding, getToken, requireAuth, pendingCalls]);

  const callReducer = async <T>(call: (conn: DbConnection) => Promise<T>): Promise<T> => {
    if (conn == null) {
      throw new Error("Not connected to SpacetimeDB yet. Try again in a moment.");
    }
    return await pendingCalls.track(call(conn));
  };

  return { rows, connectionState, connectionErrorMessage, callReducer };
}

const mcpBinding: TableBinding<McpCallLogRow> = {
  tableName: "my_visible_mcp_call_log",
  iter: (conn) => conn.db.myVisibleMcpCallLog.iter(),
  onInsert: (conn, cb) => {
    conn.db.myVisibleMcpCallLog.onInsert((_ctx: EventContext, _row: McpCallLogRow) => cb());
  },
  onDelete: (conn, cb) => {
    conn.db.myVisibleMcpCallLog.onDelete((_ctx: EventContext, _row: McpCallLogRow) => cb());
  },
  onUpdate: (conn, cb) => {
    conn.db.myVisibleMcpCallLog.onUpdate((_ctx: EventContext, _old: McpCallLogRow, _row: McpCallLogRow) => cb());
  },
};

const aiQueryBinding: TableBinding<AiQueryLogRow> = {
  tableName: "my_visible_ai_query_log",
  iter: (conn) => conn.db.myVisibleAiQueryLog.iter(),
  onInsert: (conn, cb) => {
    conn.db.myVisibleAiQueryLog.onInsert((_ctx: EventContext, _row: AiQueryLogRow) => cb());
  },
  onDelete: (conn, cb) => {
    conn.db.myVisibleAiQueryLog.onDelete((_ctx: EventContext, _row: AiQueryLogRow) => cb());
  },
  onUpdate: (conn, cb) => {
    conn.db.myVisibleAiQueryLog.onUpdate((_ctx: EventContext, _old: AiQueryLogRow, _row: AiQueryLogRow) => cb());
  },
};

const publishedQaBinding: TableBinding<PublishedQaRow> = {
  tableName: "published_qa",
  iter: (conn) => conn.db.publishedQa.iter(),
  onInsert: (conn, cb) => {
    conn.db.publishedQa.onInsert((_ctx: EventContext, _row: PublishedQaRow) => cb());
  },
  onDelete: (conn, cb) => {
    conn.db.publishedQa.onDelete((_ctx: EventContext, _row: PublishedQaRow) => cb());
  },
};

const qaEntriesBinding: TableBinding<QaEntriesRow> = {
  tableName: "my_visible_qa_entries",
  iter: (conn) => conn.db.myVisibleQaEntries.iter(),
  onInsert: (conn, cb) => {
    conn.db.myVisibleQaEntries.onInsert((_ctx: EventContext, _row: QaEntriesRow) => cb());
  },
  onDelete: (conn, cb) => {
    conn.db.myVisibleQaEntries.onDelete((_ctx: EventContext, _row: QaEntriesRow) => cb());
  },
  onUpdate: (conn, cb) => {
    conn.db.myVisibleQaEntries.onUpdate((_ctx: EventContext, _old: QaEntriesRow, _row: QaEntriesRow) => cb());
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
