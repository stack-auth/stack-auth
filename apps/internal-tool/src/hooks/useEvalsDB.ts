"use client";

import { useEffect, useRef, useState } from "react";
import { DbConnection, type EventContext, type SubscriptionEventContext } from "../module_bindings";
import type { EvalArtifactRow, EvalRunRow, EvalStepRunRow, EvalWorkflowRow, EvalWorklogRow } from "../types";

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

export type EvalsConnectionState = "connecting" | "connected" | "disconnected" | "error";

type RowWithId = { id: bigint };

function upsertById<Row extends RowWithId>(prev: Row[], row: Row): Row[] {
  const existing = prev.findIndex(r => r.id === row.id);
  if (existing >= 0) {
    const updated = [...prev];
    updated[existing] = row;
    return updated;
  }
  return [row, ...prev];
}

export function useEvalsDB() {
  const [workflows, setWorkflows] = useState<EvalWorkflowRow[]>([]);
  const [runs, setRuns] = useState<EvalRunRow[]>([]);
  const [stepRuns, setStepRuns] = useState<EvalStepRunRow[]>([]);
  const [artifacts, setArtifacts] = useState<EvalArtifactRow[]>([]);
  const [connectionState, setConnectionState] = useState<EvalsConnectionState>("connecting");
  const [conn, setConn] = useState<DbConnection | null>(null);
  const connRef = useRef<DbConnection | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    console.log("[EvalsDB] Connecting to", HOST, "db:", DB_NAME);

    function retry() {
      if (cancelled) return;
      retryCount++;
      if (retryCount > MAX_RETRIES) {
        console.error("[EvalsDB] Max retries reached");
        setConnectionState("error");
        return;
      }
      console.log(`[EvalsDB] Retrying in ${RETRY_DELAY_MS}ms (attempt ${retryCount}/${MAX_RETRIES})...`);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!cancelled) {
          connect();
        }
      }, RETRY_DELAY_MS);
    }

    function connect() {
      const connection = DbConnection.builder()
        .withUri(HOST)
        .withDatabaseName(DB_NAME)
        .withToken(localStorage.getItem(TOKEN_KEY) || undefined)
        .onConnect((connInstance: DbConnection, _identity: unknown, token: string) => {
          if (cancelled) return;
          console.log("[EvalsDB] Connected successfully");
          retryCount = 0;
          localStorage.setItem(TOKEN_KEY, token);
          connRef.current = connInstance;

          connInstance.subscriptionBuilder()
            .onApplied((ctx: SubscriptionEventContext) => {
              if (cancelled) return;
              const initialWorkflows: EvalWorkflowRow[] = [];
              for (const row of ctx.db.evalWorkflow.iter()) {
                initialWorkflows.push(row);
              }
              const initialRuns: EvalRunRow[] = [];
              for (const row of ctx.db.evalRun.iter()) {
                initialRuns.push(row);
              }
              const initialStepRuns: EvalStepRunRow[] = [];
              for (const row of ctx.db.evalStepRun.iter()) {
                initialStepRuns.push(row);
              }
              const initialArtifacts: EvalArtifactRow[] = [];
              for (const row of ctx.db.evalArtifact.iter()) {
                initialArtifacts.push(row);
              }
              console.log(
                "[EvalsDB] Loaded",
                initialWorkflows.length, "workflows,",
                initialRuns.length, "runs,",
                initialStepRuns.length, "step runs,",
                initialArtifacts.length, "artifacts"
              );
              setWorkflows(initialWorkflows);
              setRuns(initialRuns);
              setStepRuns(initialStepRuns);
              setArtifacts(initialArtifacts);
              setConnectionState("connected");
            })
            .subscribe([
              "SELECT * FROM eval_workflow",
              "SELECT * FROM eval_run",
              "SELECT * FROM eval_step_run",
              "SELECT * FROM eval_artifact",
            ]);

          // In-place edits (status, step progress, etc.) preserve the row's
          // primary key, so SpacetimeDB delivers them as onUpdate — NOT as a
          // delete+insert pair. Without an onUpdate handler the UI would only
          // ever see new rows and stay stale on every status change. onUpdate is
          // handled identically to onInsert (upsert by id).
          connInstance.db.evalWorkflow.onInsert((_ctx: EventContext, row: EvalWorkflowRow) => {
            if (cancelled) return;
            setWorkflows(prev => upsertById(prev, row));
          });
          connInstance.db.evalWorkflow.onUpdate((_ctx: EventContext, _old: EvalWorkflowRow, row: EvalWorkflowRow) => {
            if (cancelled) return;
            setWorkflows(prev => upsertById(prev, row));
          });
          connInstance.db.evalWorkflow.onDelete((_ctx: EventContext, row: EvalWorkflowRow) => {
            if (cancelled) return;
            setWorkflows(prev => prev.filter(r => r.id !== row.id));
          });

          connInstance.db.evalRun.onInsert((_ctx: EventContext, row: EvalRunRow) => {
            if (cancelled) return;
            setRuns(prev => upsertById(prev, row));
          });
          connInstance.db.evalRun.onUpdate((_ctx: EventContext, _old: EvalRunRow, row: EvalRunRow) => {
            if (cancelled) return;
            setRuns(prev => upsertById(prev, row));
          });
          connInstance.db.evalRun.onDelete((_ctx: EventContext, row: EvalRunRow) => {
            if (cancelled) return;
            setRuns(prev => prev.filter(r => r.id !== row.id));
          });

          connInstance.db.evalStepRun.onInsert((_ctx: EventContext, row: EvalStepRunRow) => {
            if (cancelled) return;
            setStepRuns(prev => upsertById(prev, row));
          });
          connInstance.db.evalStepRun.onUpdate((_ctx: EventContext, _old: EvalStepRunRow, row: EvalStepRunRow) => {
            if (cancelled) return;
            setStepRuns(prev => upsertById(prev, row));
          });
          connInstance.db.evalStepRun.onDelete((_ctx: EventContext, row: EvalStepRunRow) => {
            if (cancelled) return;
            setStepRuns(prev => prev.filter(r => r.id !== row.id));
          });

          connInstance.db.evalArtifact.onInsert((_ctx: EventContext, row: EvalArtifactRow) => {
            if (cancelled) return;
            setArtifacts(prev => upsertById(prev, row));
          });
          connInstance.db.evalArtifact.onUpdate((_ctx: EventContext, _old: EvalArtifactRow, row: EvalArtifactRow) => {
            if (cancelled) return;
            setArtifacts(prev => upsertById(prev, row));
          });
          connInstance.db.evalArtifact.onDelete((_ctx: EventContext, row: EvalArtifactRow) => {
            if (cancelled) return;
            setArtifacts(prev => prev.filter(r => r.id !== row.id));
          });

          setConn(connInstance);
        })
        .onConnectError((_ctx: unknown, err: unknown) => {
          // Tearing down a still-connecting socket (React StrictMode remount or
          // unmount) fires this with an empty event. That's our own abort, not
          // a real failure — don't log it as an error or trigger a retry.
          if (cancelled) return;
          console.error("[EvalsDB] Connection error:", err);
          const storedToken = localStorage.getItem(TOKEN_KEY);
          if (storedToken) {
            console.log("[EvalsDB] Clearing stale token");
            localStorage.removeItem(TOKEN_KEY);
          }
          setConn(null);
          retry();
        })
        .build();

      connRef.current = connection;
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
      setConn(null);
    };
  }, []);

  return { workflows, runs, stepRuns, artifacts, connectionState, conn };
}

/**
 * Live worklog rows for a single step run, sorted by seq.
 *
 * eval_worklog can be huge, so this subscribes to just the selected step run
 * and unsubscribes when the selection changes or the component unmounts.
 */
export function useWorklog(conn: DbConnection | null, stepRunId: string | null): EvalWorklogRow[] {
  const [rows, setRows] = useState<EvalWorklogRow[]>([]);

  useEffect(() => {
    setRows([]);
    if (!conn || !stepRunId) return;

    let cancelled = false;
    // stepRunId values are sanitized internally, but escape quotes anyway.
    const escaped = stepRunId.replace(/'/g, "''");

    const onInsert = (_ctx: EventContext, row: EvalWorklogRow) => {
      if (cancelled || row.stepRunId !== stepRunId) return;
      setRows(prev => {
        if (prev.some(r => r.id === row.id)) return prev;
        const next = [...prev, row];
        next.sort((a, b) => a.seq - b.seq);
        return next;
      });
    };
    const onDelete = (_ctx: EventContext, row: EvalWorklogRow) => {
      if (cancelled || row.stepRunId !== stepRunId) return;
      setRows(prev => prev.filter(r => r.id !== row.id));
    };
    conn.db.evalWorklog.onInsert(onInsert);
    conn.db.evalWorklog.onDelete(onDelete);

    const handle = conn.subscriptionBuilder()
      .onApplied((ctx: SubscriptionEventContext) => {
        if (cancelled) return;
        const initial: EvalWorklogRow[] = [];
        for (const row of ctx.db.evalWorklog.iter()) {
          if (row.stepRunId === stepRunId) {
            initial.push(row);
          }
        }
        initial.sort((a, b) => a.seq - b.seq);
        setRows(initial);
      })
      .onError((_ctx: unknown) => {
        console.error("[EvalsDB] Worklog subscription error for", stepRunId);
      })
      .subscribe(`SELECT * FROM eval_worklog WHERE step_run_id = '${escaped}'`);

    return () => {
      cancelled = true;
      conn.db.evalWorklog.removeOnInsert(onInsert);
      conn.db.evalWorklog.removeOnDelete(onDelete);
      try {
        handle.unsubscribe();
      } catch {
        // Subscription may not have been applied yet or the connection may be
        // gone; either way there is nothing to clean up.
      }
    };
  }, [conn, stepRunId]);

  return rows;
}
