// Server-side SpacetimeDB connection for the eval suite. Maintains a single
// long-lived connection (surviving Next.js HMR via globalThis) with an
// in-memory mirror of the eval tables, and exposes token-injected reducer
// helpers used by the orchestrator, API routes and the control chat agent.

import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { DbConnection } from "@/module_bindings";
import type { EvalArtifactRow, EvalRunRow, EvalStepRunRow, EvalWorkflowRow, EvalWorklogRow } from "@/types";
import { getLogToken, getSpacetimeDbName, getSpacetimeHost } from "./config";

export type EvalDb = {
  conn: DbConnection,
  cache: {
    workflows: Map<string, EvalWorkflowRow>,
    runs: Map<string, EvalRunRow>,
    stepRuns: Map<string, EvalStepRunRow>,
    worklogs: Map<string, EvalWorklogRow[]>,
    artifacts: Map<string, EvalArtifactRow[]>,
  },
};

const SUBSCRIPTIONS = [
  "SELECT * FROM eval_workflow",
  "SELECT * FROM eval_run",
  "SELECT * FROM eval_step_run",
  "SELECT * FROM eval_worklog",
  "SELECT * FROM eval_artifact",
];

const globalStore = globalThis as unknown as { __hexclaveEvalDb?: Promise<EvalDb> };

export function getEvalDb(): Promise<EvalDb> {
  if (!globalStore.__hexclaveEvalDb) {
    globalStore.__hexclaveEvalDb = connect().catch(error => {
      // Allow a later call to retry instead of caching the failure forever.
      globalStore.__hexclaveEvalDb = undefined;
      throw error;
    });
  }
  return globalStore.__hexclaveEvalDb;
}

function connect(): Promise<EvalDb> {
  return new Promise<EvalDb>((resolve, reject) => {
    const cache: EvalDb["cache"] = {
      workflows: new Map(),
      runs: new Map(),
      stepRuns: new Map(),
      worklogs: new Map(),
      artifacts: new Map(),
    };

    let settled = false;
    const conn = DbConnection.builder()
      .withUri(getSpacetimeHost())
      .withDatabaseName(getSpacetimeDbName())
      .onConnect(connInstance => {
        registerCacheHandlers(connInstance, cache);
        let applied = 0;
        for (const query of SUBSCRIPTIONS) {
          connInstance.subscriptionBuilder()
            .onApplied(() => {
              applied += 1;
              if (applied === SUBSCRIPTIONS.length && !settled) {
                settled = true;
                resolve({ conn: connInstance, cache });
              }
            })
            .onError(errorCtx => {
              if (!settled) {
                settled = true;
                reject(new Error(`Eval subscription failed: ${String(errorCtx.event ?? "unknown error")}`));
              }
            })
            .subscribe(query);
        }
      })
      .onConnectError((_ctx, error) => {
        if (!settled) {
          settled = true;
          reject(new Error(`Failed to connect to SpacetimeDB at ${getSpacetimeHost()}: ${error.message}`));
        }
        globalStore.__hexclaveEvalDb = undefined;
      })
      .onDisconnect(() => {
        globalStore.__hexclaveEvalDb = undefined;
      })
      .build();
    void conn;
  });
}

function registerCacheHandlers(conn: DbConnection, cache: EvalDb["cache"]): void {
  // The update reducers delete+re-insert a row preserving its primary key `id`,
  // which SpacetimeDB delivers as an `onUpdate` (NOT insert/delete). Every table
  // therefore needs an onUpdate handler or in-place edits (status/progress/etc.)
  // silently never reach the cache. Update is handled identically to insert.
  conn.db.evalWorkflow.onInsert((_ctx, row) => cache.workflows.set(row.workflowId, row));
  conn.db.evalWorkflow.onUpdate((_ctx, _old, row) => cache.workflows.set(row.workflowId, row));
  conn.db.evalWorkflow.onDelete((_ctx, row) => {
    if (cache.workflows.get(row.workflowId)?.id === row.id) cache.workflows.delete(row.workflowId);
  });

  conn.db.evalRun.onInsert((_ctx, row) => cache.runs.set(row.runId, row));
  conn.db.evalRun.onUpdate((_ctx, _old, row) => cache.runs.set(row.runId, row));
  conn.db.evalRun.onDelete((_ctx, row) => {
    if (cache.runs.get(row.runId)?.id === row.id) cache.runs.delete(row.runId);
  });

  conn.db.evalStepRun.onInsert((_ctx, row) => cache.stepRuns.set(row.stepRunId, row));
  conn.db.evalStepRun.onUpdate((_ctx, _old, row) => cache.stepRuns.set(row.stepRunId, row));
  conn.db.evalStepRun.onDelete((_ctx, row) => {
    if (cache.stepRuns.get(row.stepRunId)?.id === row.id) cache.stepRuns.delete(row.stepRunId);
  });

  const upsertWorklog = (row: EvalWorklogRow) => {
    const list = cache.worklogs.get(row.stepRunId) ?? [];
    const idx = list.findIndex(r => r.id === row.id);
    if (idx >= 0) list[idx] = row;
    else list.push(row);
    cache.worklogs.set(row.stepRunId, list);
  };
  conn.db.evalWorklog.onInsert((_ctx, row) => upsertWorklog(row));
  conn.db.evalWorklog.onUpdate((_ctx, _old, row) => upsertWorklog(row));
  conn.db.evalWorklog.onDelete((_ctx, row) => {
    const list = cache.worklogs.get(row.stepRunId);
    if (list) cache.worklogs.set(row.stepRunId, list.filter(r => r.id !== row.id));
  });

  const upsertArtifact = (row: EvalArtifactRow) => {
    const list = cache.artifacts.get(row.runId) ?? [];
    const idx = list.findIndex(r => r.id === row.id);
    if (idx >= 0) list[idx] = row;
    else list.push(row);
    cache.artifacts.set(row.runId, list);
  };
  conn.db.evalArtifact.onInsert((_ctx, row) => upsertArtifact(row));
  conn.db.evalArtifact.onUpdate((_ctx, _old, row) => upsertArtifact(row));
  conn.db.evalArtifact.onDelete((_ctx, row) => {
    const list = cache.artifacts.get(row.runId);
    if (list) cache.artifacts.set(row.runId, list.filter(r => r.id !== row.id));
  });
}

// --- Reducer helpers (token injected) ---

export async function upsertEvalWorkflow(args: { workflowId: string, name: string, description: string, stepsJson: string, defaultModel: string }): Promise<void> {
  const db = await getEvalDb();
  await db.conn.reducers.upsertEvalWorkflow({ token: getLogToken(), ...args });
}

export async function deleteEvalWorkflow(workflowId: string): Promise<void> {
  const db = await getEvalDb();
  await db.conn.reducers.deleteEvalWorkflow({ token: getLogToken(), workflowId });
}

export async function createEvalRun(args: { runId: string, workflowId: string, workflowName: string, label: string, model: string, totalSteps: number, configJson: string }): Promise<void> {
  const db = await getEvalDb();
  await db.conn.reducers.createEvalRun({ token: getLogToken(), ...args });
}

export async function updateEvalRun(args: { runId: string, status: string, sandboxId?: string, currentStepIndex: number, contextJson?: string, error?: string }): Promise<void> {
  const db = await getEvalDb();
  await db.conn.reducers.updateEvalRun({
    token: getLogToken(),
    runId: args.runId,
    status: args.status,
    sandboxId: args.sandboxId,
    currentStepIndex: args.currentStepIndex,
    contextJson: args.contextJson,
    error: args.error,
  });
}

export async function upsertEvalStepRun(args: { stepRunId: string, runId: string, stepIndex: number, stepName: string, model: string, status: string, resultText: string, error?: string, numMessages: number, costUsd?: string, inputTokens?: bigint, outputTokens?: bigint, cacheReadTokens?: bigint, cacheCreationTokens?: bigint, sessionId?: string }): Promise<void> {
  const db = await getEvalDb();
  await db.conn.reducers.upsertEvalStepRun({
    token: getLogToken(),
    stepRunId: args.stepRunId,
    runId: args.runId,
    stepIndex: args.stepIndex,
    stepName: args.stepName,
    model: args.model,
    status: args.status,
    resultText: args.resultText,
    error: args.error,
    numMessages: args.numMessages,
    costUsd: args.costUsd,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    cacheReadTokens: args.cacheReadTokens,
    cacheCreationTokens: args.cacheCreationTokens,
    sessionId: args.sessionId,
  });
}

export async function appendEvalWorklog(args: { runId: string, stepRunId: string, entries: { seq: number, kind: string, content: string }[] }): Promise<void> {
  const db = await getEvalDb();
  await db.conn.reducers.appendEvalWorklog({
    token: getLogToken(),
    runId: args.runId,
    stepRunId: args.stepRunId,
    entriesJson: JSON.stringify(args.entries),
  });
}

export async function addEvalArtifact(args: { runId: string, stepRunId: string, path: string, contentType: string, content: string }): Promise<void> {
  const db = await getEvalDb();
  await db.conn.reducers.addEvalArtifact({ token: getLogToken(), ...args });
}

export async function deleteEvalRun(runId: string): Promise<void> {
  const db = await getEvalDb();
  await db.conn.reducers.deleteEvalRun({ token: getLogToken(), runId });
}

// --- Cached reads ---

export async function listWorkflows(): Promise<EvalWorkflowRow[]> {
  const db = await getEvalDb();
  return [...db.cache.workflows.values()].sort((a, b) => stringCompare(a.name, b.name));
}

export async function getWorkflow(workflowId: string): Promise<EvalWorkflowRow | undefined> {
  const db = await getEvalDb();
  return db.cache.workflows.get(workflowId);
}

export async function listRuns(): Promise<EvalRunRow[]> {
  const db = await getEvalDb();
  return [...db.cache.runs.values()].sort((a, b) => Number(b.id - a.id));
}

export async function getRun(runId: string): Promise<EvalRunRow | undefined> {
  const db = await getEvalDb();
  return db.cache.runs.get(runId);
}

export async function listStepRuns(runId: string): Promise<EvalStepRunRow[]> {
  const db = await getEvalDb();
  return [...db.cache.stepRuns.values()]
    .filter(s => s.runId === runId)
    .sort((a, b) => a.stepIndex - b.stepIndex);
}

export async function getStepRun(stepRunId: string): Promise<EvalStepRunRow | undefined> {
  const db = await getEvalDb();
  return db.cache.stepRuns.get(stepRunId);
}

export async function listWorklog(stepRunId: string): Promise<EvalWorklogRow[]> {
  const db = await getEvalDb();
  return [...(db.cache.worklogs.get(stepRunId) ?? [])].sort((a, b) => a.seq - b.seq);
}

export async function listArtifacts(runId: string): Promise<EvalArtifactRow[]> {
  const db = await getEvalDb();
  return [...(db.cache.artifacts.get(runId) ?? [])];
}
