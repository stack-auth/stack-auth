"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { format } from "date-fns";
import type { DbConnection } from "../../module_bindings";
import type { EvalArtifactRow, EvalRunRow, EvalStepRunRow } from "../../types";
import { toDate } from "../../utils";
import { StatusBadge } from "./status";
import { RunDetail } from "./RunDetail";

const ACTIVE_STATUSES = ["queued", "booting", "running"];

function duration(run: EvalRunRow): string {
  if (!run.startedAt) return "—";
  const startMs = toDate(run.startedAt).getTime();
  const endMs = run.finishedAt ? toDate(run.finishedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function RunsPanel({
  runs,
  stepRuns,
  artifacts,
  conn,
}: {
  runs: EvalRunRow[],
  stepRuns: EvalStepRunRow[],
  artifacts: EvalArtifactRow[],
  conn: DbConnection | null,
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const sorted = [...runs].sort((a, b) => Number(b.id - a.id));
  const selectedRun = sorted.find(r => r.runId === selectedRunId) ?? null;

  // Only count selections that still correspond to a visible run, so deleted
  // rows can't leave phantom entries in the selection.
  const checkedRuns = sorted.filter(r => checkedIds.has(r.runId));
  const cancellableChecked = checkedRuns.filter(r => ACTIVE_STATUSES.includes(r.status));
  const allChecked = sorted.length > 0 && checkedRuns.length === sorted.length;
  const someChecked = checkedRuns.length > 0 && !allChecked;

  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someChecked;
  }, [someChecked]);

  const toggleOne = (runId: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const toggleAll = () => {
    setCheckedIds(allChecked ? new Set() : new Set(sorted.map(r => r.runId)));
  };

  const clearChecked = () => setCheckedIds(new Set());

  // Fire the API call for a single run; return an error message or null.
  const requestCancel = async (runId: string): Promise<string | null> => {
    const res = await fetch(`/api/evals/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({})) as { error?: string };
    return data.error ?? `Cancel failed (${res.status})`;
  };

  const requestDelete = async (runId: string): Promise<string | null> => {
    const res = await fetch(`/api/evals/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({})) as { error?: string };
    return data.error ?? `Delete failed (${res.status})`;
  };

  const cancelRun = async (runId: string) => {
    if (!window.confirm("Cancel this run? The sandbox will be stopped.")) return;
    setActionError(null);
    const err = await requestCancel(runId);
    if (err) setActionError(err);
  };

  const deleteRun = async (runId: string) => {
    if (!window.confirm("Delete this run and all of its logs/artifacts? This cannot be undone.")) return;
    setActionError(null);
    const err = await requestDelete(runId);
    if (err) setActionError(err);
    else if (selectedRunId === runId) setSelectedRunId(null);
  };

  // Run the per-run action across a batch in parallel, then report how many
  // (if any) failed without spamming a confirm per row.
  const runBulk = async (
    runIds: string[],
    verb: string,
    action: (runId: string) => Promise<string | null>,
  ) => {
    if (runIds.length === 0) return;
    setActionError(null);
    setBulkBusy(true);
    try {
      const results = await Promise.all(runIds.map(action));
      const errors = results.filter((e): e is string => e !== null);
      if (errors.length > 0) {
        setActionError(`${errors.length} of ${runIds.length} ${verb} failed — first error: ${errors[0]}`);
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkCancel = async () => {
    const ids = cancellableChecked.map(r => r.runId);
    if (ids.length === 0) return;
    if (!window.confirm(`Cancel ${ids.length} running run${ids.length === 1 ? "" : "s"}? Their sandboxes will be stopped.`)) return;
    await runBulk(ids, "cancels", requestCancel);
  };

  const bulkDelete = async () => {
    const ids = checkedRuns.map(r => r.runId);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} run${ids.length === 1 ? "" : "s"} and all their logs/artifacts? This cannot be undone.`)) return;
    await runBulk(ids, "deletes", requestDelete);
    if (selectedRunId && ids.includes(selectedRunId)) setSelectedRunId(null);
    clearChecked();
  };

  return (
    <div className="flex gap-4 items-start">
      <div className={clsx("min-w-0", selectedRun ? "w-[40%]" : "flex-1")}>
        {actionError && (
          <div className="mb-3 px-3 py-2 bg-red-50 ring-1 ring-red-200 rounded-md text-xs text-red-700">{actionError}</div>
        )}
        {checkedRuns.length > 0 && (
          <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-blue-50 ring-1 ring-blue-200 rounded-md">
            <span className="text-xs font-medium text-blue-900">{checkedRuns.length} selected</span>
            {cancellableChecked.length > 0 && (
              <button
                onClick={() => runAsynchronously(bulkCancel)}
                disabled={bulkBusy}
                className="px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 rounded-md disabled:opacity-50"
              >
                Cancel ({cancellableChecked.length})
              </button>
            )}
            <button
              onClick={() => runAsynchronously(bulkDelete)}
              disabled={bulkBusy}
              className="px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-100 rounded-md disabled:opacity-50"
            >
              Delete ({checkedRuns.length})
            </button>
            <button
              onClick={clearChecked}
              disabled={bulkBusy}
              className="ml-auto px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 rounded-md disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        )}
        {sorted.length === 0 ? (
          <div className="bg-white rounded-lg ring-1 ring-gray-200 p-10 text-center text-sm text-gray-400">
            No runs yet. Hit “New Run” to launch the default Hexclave eval workflow.
          </div>
        ) : (
          <div className="bg-white rounded-lg ring-1 ring-gray-200 overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="px-3 py-2 w-9">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      aria-label="Select all runs"
                      className="cursor-pointer align-middle"
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Run</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Step</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(run => (
                  <tr
                    key={String(run.id)}
                    onClick={() => setSelectedRunId(run.runId)}
                    className={clsx(
                      "border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50",
                      run.runId === selectedRunId && "bg-blue-50/60 hover:bg-blue-50/60",
                    )}
                  >
                    <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checkedIds.has(run.runId)}
                        onChange={() => toggleOne(run.runId)}
                        aria-label={`Select run ${run.label}`}
                        className="cursor-pointer align-middle"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs font-medium text-gray-900 truncate max-w-[260px]">{run.label}</div>
                      <div className="text-[10px] text-gray-400 truncate">{run.workflowName}</div>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-600 truncate max-w-[180px]">{run.model}</td>
                    <td className="px-3 py-2"><StatusBadge status={run.status} /></td>
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{run.currentStepIndex}/{Math.max(run.totalSteps - 1, 0)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{format(toDate(run.createdAt), "MMM d HH:mm")}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{duration(run)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      {ACTIVE_STATUSES.includes(run.status) && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            runAsynchronously(() => cancelRun(run.runId));
                          }}
                          className="px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-50 rounded-md"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          runAsynchronously(() => deleteRun(run.runId));
                        }}
                        className="px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 rounded-md"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedRun && (
        <div className="flex-1 min-w-0 bg-white rounded-lg ring-1 ring-gray-200 p-4">
          <RunDetail
            run={selectedRun}
            stepRuns={stepRuns}
            artifacts={artifacts}
            conn={conn}
            onClose={() => setSelectedRunId(null)}
          />
        </div>
      )}
    </div>
  );
}
