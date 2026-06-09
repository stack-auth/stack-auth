"use client";

import { useState } from "react";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import type { EvalWorkflowRow } from "../../types";
import { ModelResultRow, useModelSearch } from "./ModelPicker";

export function RunLauncher({
  workflows,
  onClose,
  onLaunched,
}: {
  workflows: EvalWorkflowRow[],
  onClose: () => void,
  onLaunched: () => void,
}) {
  const sorted = [...workflows].sort((a, b) => stringCompare(a.name, b.name));
  const [workflowId, setWorkflowId] = useState<string>(sorted[0]?.workflowId ?? "");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [runsPerModel, setRunsPerModel] = useState(1);
  const [timeoutMinutes, setTimeoutMinutes] = useState(45);
  const [labelPrefix, setLabelPrefix] = useState("");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { models, loading } = useModelSearch(search);

  const workflow = sorted.find(w => w.workflowId === workflowId);
  const totalRuns = selectedModels.length * runsPerModel;

  const addModel = (id: string) => {
    const slug = id.trim();
    if (slug === "" || selectedModels.includes(slug)) return;
    setSelectedModels(prev => [...prev, slug]);
    setSearch("");
  };

  const launch = async () => {
    if (!workflowId) {
      setError("Pick a workflow");
      return;
    }
    if (selectedModels.length === 0) {
      setError("Pick at least one model");
      return;
    }
    setLaunching(true);
    setError(null);
    try {
      const res = await fetch("/api/evals/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workflowId,
          models: selectedModels,
          runsPerModel,
          timeoutMinutes,
          labelPrefix: labelPrefix.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({})) as { runIds?: string[], error?: string };
      if (!res.ok) throw new Error(data.error ?? `Launch failed (${res.status})`);
      onLaunched();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">New eval run</h2>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">✕ close</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-[10px] text-gray-400 mb-0.5">Workflow</label>
            <select
              value={workflowId}
              onChange={e => setWorkflowId(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {sorted.map(w => <option key={w.workflowId} value={w.workflowId}>{w.name}</option>)}
            </select>
            {workflow && <p className="mt-1 text-[11px] text-gray-400">{workflow.description}</p>}
          </div>

          <div>
            <label className="block text-[10px] text-gray-400 mb-0.5">Models (OpenRouter)</label>
            {selectedModels.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedModels.map(model => (
                  <span key={model} className="inline-flex items-center gap-1 bg-blue-50 ring-1 ring-blue-200 text-blue-800 rounded-md px-2 py-0.5 text-xs font-mono">
                    {model}
                    <button
                      onClick={() => setSelectedModels(prev => prev.filter(m => m !== model))}
                      className="text-blue-400 hover:text-blue-700"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && search.trim() !== "") {
                  e.preventDefault();
                  addModel(search);
                }
              }}
              placeholder="Search models… (Enter adds the typed slug directly)"
              className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md ring-1 ring-gray-200 divide-y divide-gray-100">
              {loading && models.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">Loading models…</div>}
              {!loading && models.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">No matches — press Enter to add the typed slug.</div>}
              {models.map(model => (
                <ModelResultRow key={model.id} model={model} onPick={addModel} />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] text-gray-400 mb-0.5">Runs per model (1-10)</label>
              <input
                type="number"
                min={1}
                max={10}
                value={runsPerModel}
                onChange={e => setRunsPerModel(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-400 mb-0.5">Timeout (minutes, max 300)</label>
              <input
                type="number"
                min={5}
                max={300}
                value={timeoutMinutes}
                onChange={e => setTimeoutMinutes(Math.max(5, Math.min(300, Number(e.target.value) || 45)))}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-400 mb-0.5">Label prefix (optional)</label>
              <input
                type="text"
                value={labelPrefix}
                onChange={e => setLabelPrefix(e.target.value)}
                placeholder="batch"
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {error
              ? <span className="text-red-600">{error}</span>
              : `${selectedModels.length} models × ${runsPerModel} runs = ${totalRuns} sandboxes`}
          </span>
          <button
            onClick={() => runAsynchronously(launch)}
            disabled={launching || totalRuns === 0}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {launching ? "Launching…" : `Launch ${totalRuns > 0 ? totalRuns : ""} run${totalRuns === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
