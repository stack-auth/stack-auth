"use client";

import { clsx } from "clsx";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useEffect, useState } from "react";
import type { DbConnection } from "../../module_bindings";
import type { EvalArtifactRow, EvalRunRow, EvalStepRunRow } from "../../types";
import { toDate } from "../../utils";
import { useWorklog } from "../../hooks/useEvalsDB";
import { StatusBadge, statusBadgeClass } from "./status";
import { WorklogViewer } from "./WorklogViewer";

function formatDuration(start: unknown, end: unknown): string | null {
  if (!start) return null;
  const startMs = toDate(start).getTime();
  const endMs = end ? toDate(end).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function ArtifactModal({ artifact, onClose }: { artifact: EvalArtifactRow, onClose: () => void }) {
  const isHtml = artifact.contentType === "text/html";
  const download = () => {
    const blob = new Blob([artifact.content], { type: artifact.contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = artifact.path.split("/").pop() ?? "artifact";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full h-full max-w-6xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
          <span className="text-xs font-mono text-gray-600 truncate">{artifact.path}</span>
          <div className="flex items-center gap-2">
            <button onClick={download} className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200">
              Download
            </button>
            <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200">
              Close
            </button>
          </div>
        </div>
        {isHtml ? (
          <iframe title={artifact.path} sandbox="" srcDoc={artifact.content} className="flex-1 w-full bg-white" />
        ) : (
          <pre className="flex-1 overflow-auto p-4 font-mono text-xs text-gray-800 whitespace-pre-wrap">{artifact.content}</pre>
        )}
      </div>
    </div>
  );
}

function ExecConsole({ runId }: { runId: string }) {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ command: string, exitCode: number | null, stdout: string, stderr: string }[]>([]);

  const run = async () => {
    const cmd = command.trim();
    if (cmd === "" || busy) return;
    setBusy(true);
    setCommand("");
    try {
      const res = await fetch(`/api/evals/runs/${encodeURIComponent(runId)}/exec`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json() as { exitCode?: number, stdout?: string, stderr?: string, error?: string };
      if (!res.ok) {
        setHistory(prev => [...prev, { command: cmd, exitCode: null, stdout: "", stderr: data.error ?? `Request failed (${res.status})` }]);
      } else {
        setHistory(prev => [...prev, { command: cmd, exitCode: data.exitCode ?? null, stdout: data.stdout ?? "", stderr: data.stderr ?? "" }]);
      }
    } catch (error) {
      setHistory(prev => [...prev, { command: cmd, exitCode: null, stdout: "", stderr: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {history.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-y-auto rounded-md bg-gray-900 p-3">
          {history.map((entry, i) => (
            <div key={i} className="font-mono text-[11px]">
              <div className="text-green-400">$ {entry.command} <span className="text-gray-500">{entry.exitCode !== null ? `(exit ${entry.exitCode})` : ""}</span></div>
              {entry.stdout && <pre className="text-gray-200 whitespace-pre-wrap">{entry.stdout}</pre>}
              {entry.stderr && <pre className="text-red-400 whitespace-pre-wrap">{entry.stderr}</pre>}
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") runAsynchronously(run); }}
          placeholder="Shell command (cwd: /vercel/sandbox/workspace)"
          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => void run()}
          disabled={busy || command.trim() === ""}
          className="px-3 py-1.5 text-xs font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900 disabled:opacity-50"
        >
          {busy ? "Running…" : "Run"}
        </button>
      </div>
    </div>
  );
}

export function RunDetail({
  run,
  stepRuns,
  artifacts,
  conn,
  onClose,
}: {
  run: EvalRunRow,
  stepRuns: EvalStepRunRow[],
  artifacts: EvalArtifactRow[],
  conn: DbConnection | null,
  onClose: () => void,
}) {
  const steps = stepRuns.filter(s => s.runId === run.runId).sort((a, b) => a.stepIndex - b.stepIndex);
  const runArtifacts = artifacts.filter(a => a.runId === run.runId);
  const [selectedStepRunId, setSelectedStepRunId] = useState<string | null>(null);
  const [viewedArtifact, setViewedArtifact] = useState<EvalArtifactRow | null>(null);

  // Default selection: the running step, else the last step.
  useEffect(() => {
    if (selectedStepRunId && steps.some(s => s.stepRunId === selectedStepRunId)) return;
    const running = steps.find(s => s.status === "running");
    const fallback = steps.at(-1);
    setSelectedStepRunId(running?.stepRunId ?? fallback?.stepRunId ?? null);
  }, [steps.length, run.runId]);

  const selectedStep = steps.find(s => s.stepRunId === selectedStepRunId) ?? null;
  const worklog = useWorklog(conn, selectedStepRunId);
  const sandboxAlive = ["booting", "running", "failed"].includes(run.status);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-gray-900 truncate">{run.label}</h2>
            <StatusBadge status={run.status} />
          </div>
          <div className="mt-1 text-xs text-gray-500 flex items-center gap-3 flex-wrap">
            <span>{run.workflowName}</span>
            <span className="font-mono">{run.model}</span>
            {run.sandboxId && <span className="font-mono text-[10px] text-gray-400">sandbox {run.sandboxId}</span>}
            <span>{formatDuration(run.startedAt, run.finishedAt) ?? "not started"}</span>
          </div>
          {run.error && <div className="mt-1 text-xs text-red-600">{run.error}</div>}
        </div>
        <button onClick={onClose} className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600 shrink-0">✕ close</button>
      </div>

      {/* Step timeline */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {steps.map(step => (
          <button
            key={step.stepRunId}
            onClick={() => setSelectedStepRunId(step.stepRunId)}
            className={clsx(
              "px-2.5 py-1 rounded-md text-xs font-medium ring-1",
              step.stepRunId === selectedStepRunId ? "ring-blue-500 ring-2" : "ring-transparent",
              statusBadgeClass(step.status),
            )}
          >
            {step.stepIndex}. {step.stepName}
          </button>
        ))}
        {steps.length === 0 && <span className="text-xs text-gray-400">No steps yet…</span>}
      </div>

      {/* Selected step */}
      {selectedStep && (
        <div className="space-y-2">
          <div className="text-xs text-gray-500 flex items-center gap-3 flex-wrap">
            <span className="font-medium text-gray-700">{selectedStep.stepName}</span>
            {selectedStep.model !== "-" && <span className="font-mono">{selectedStep.model}</span>}
            <span>{selectedStep.numMessages} messages</span>
            {selectedStep.costUsd && <span className="font-mono">${selectedStep.costUsd}</span>}
            <span>{formatDuration(selectedStep.startedAt, selectedStep.finishedAt) ?? ""}</span>
            {selectedStep.error && <span className="text-red-600">{selectedStep.error}</span>}
          </div>
          <WorklogViewer rows={worklog} />
        </div>
      )}

      {/* Artifacts */}
      {runArtifacts.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-700 mb-2">Artifacts</h3>
          <div className="space-y-1.5">
            {runArtifacts.map(artifact => (
              <div key={String(artifact.id)} className="flex items-center justify-between gap-2 bg-white rounded-md ring-1 ring-gray-200 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-mono text-gray-700 truncate">{artifact.path}</div>
                  <div className="text-[10px] text-gray-400">{artifact.contentType} · {(artifact.content.length / 1024).toFixed(1)} KB</div>
                </div>
                <button
                  onClick={() => setViewedArtifact(artifact)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 shrink-0"
                >
                  {artifact.contentType === "text/html" ? "View report" : "View"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Exec console */}
      {sandboxAlive && (
        <div>
          <h3 className="text-xs font-semibold text-gray-700 mb-2">
            Sandbox exec
            {run.status === "failed" && <span className="ml-2 font-normal text-gray-400">(failed runs keep their sandbox alive until timeout)</span>}
          </h3>
          <ExecConsole runId={run.runId} />
        </div>
      )}

      {viewedArtifact && <ArtifactModal artifact={viewedArtifact} onClose={() => setViewedArtifact(null)} />}
    </div>
  );
}
