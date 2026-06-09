"use client";

import { useState } from "react";
import { format } from "date-fns";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import type { EvalWorkflowRow } from "../../types";
import { parseSteps, type EvalStepDefinition } from "../../lib/evals/types";
import { toDate } from "../../utils";
import { ModelPicker } from "./ModelPicker";

type EditorState = {
  workflowId: string | null, // null = create new
  name: string,
  description: string,
  defaultModel: string,
  steps: EvalStepDefinition[],
};

const EMPTY_STEP: EvalStepDefinition = { name: "", prompt: "" };

function safeParseSteps(stepsJson: string): EvalStepDefinition[] {
  try {
    return parseSteps(stepsJson);
  } catch {
    return [];
  }
}

function StepEditor({
  step,
  index,
  count,
  onChange,
  onRemove,
  onMove,
}: {
  step: EvalStepDefinition,
  index: number,
  count: number,
  onChange: (step: EvalStepDefinition) => void,
  onRemove: () => void,
  onMove: (direction: -1 | 1) => void,
}) {
  return (
    <div className="rounded-md ring-1 ring-gray-200 bg-gray-50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-500 shrink-0">Step {index + 1}</span>
        <input
          type="text"
          value={step.name}
          onChange={e => onChange({ ...step, name: e.target.value })}
          placeholder="Step name"
          className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={() => onMove(-1)} disabled={index === 0} className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30">↑</button>
        <button onClick={() => onMove(1)} disabled={index === count - 1} className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30">↓</button>
        <button onClick={onRemove} disabled={count === 1} className="px-1.5 py-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-30">✕</button>
      </div>
      <textarea
        value={step.prompt}
        onChange={e => onChange({ ...step, prompt: e.target.value })}
        placeholder="Agent prompt. Reference earlier step outputs with {outputKey} placeholders."
        rows={8}
        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-[10px] text-gray-400 mb-0.5">Output key (template variable)</label>
          <input
            type="text"
            value={step.outputKey ?? ""}
            onChange={e => onChange({ ...step, outputKey: e.target.value || undefined })}
            placeholder={`step${index + 1}`}
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-400 mb-0.5">Model override (optional)</label>
          <ModelPicker
            value={step.model ?? ""}
            onChange={value => onChange({ ...step, model: value || undefined })}
            placeholder="run default"
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-400 mb-0.5">Artifacts (comma-separated paths)</label>
          <input
            type="text"
            value={(step.artifacts ?? []).join(", ")}
            onChange={e => {
              const artifacts = e.target.value.split(",").map(s => s.trim()).filter(s => s !== "");
              onChange({ ...step, artifacts: artifacts.length > 0 ? artifacts : undefined });
            }}
            placeholder="/vercel/sandbox/.eval/report.html"
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  );
}

function WorkflowEditorModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: EditorState,
  onClose: () => void,
  onSaved: () => void,
}) {
  const [state, setState] = useState<EditorState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateStep = (index: number, step: EvalStepDefinition) => {
    setState(prev => ({ ...prev, steps: prev.steps.map((s, i) => i === index ? step : s) }));
  };

  const save = async () => {
    if (state.name.trim() === "") {
      setError("Name is required");
      return;
    }
    if (state.steps.some(s => s.name.trim() === "" || s.prompt.trim() === "")) {
      setError("Every step needs a name and a prompt");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/evals/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workflowId: state.workflowId ?? undefined,
          name: state.name,
          description: state.description,
          defaultModel: state.defaultModel || "anthropic/claude-sonnet-4.6",
          stepsJson: JSON.stringify(state.steps, null, 2),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Save failed (${res.status})`);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">{state.workflowId ? "Edit workflow" : "New workflow"}</h2>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">✕ close</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-gray-400 mb-0.5">Name</label>
              <input
                type="text"
                value={state.name}
                onChange={e => setState(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-400 mb-0.5">Default model (OpenRouter slug)</label>
              <ModelPicker
                value={state.defaultModel}
                onChange={value => setState(prev => ({ ...prev, defaultModel: value }))}
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 mb-0.5">Description</label>
            <textarea
              value={state.description}
              onChange={e => setState(prev => ({ ...prev, description: e.target.value }))}
              rows={2}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="space-y-2">
            {state.steps.map((step, index) => (
              <StepEditor
                key={index}
                step={step}
                index={index}
                count={state.steps.length}
                onChange={s => updateStep(index, s)}
                onRemove={() => setState(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== index) }))}
                onMove={direction => setState(prev => {
                  const steps = [...prev.steps];
                  const target = index + direction;
                  if (target < 0 || target >= steps.length) return prev;
                  [steps[index], steps[target]] = [steps[target], steps[index]];
                  return { ...prev, steps };
                })}
              />
            ))}
            <button
              onClick={() => setState(prev => ({ ...prev, steps: [...prev.steps, { ...EMPTY_STEP }] }))}
              className="w-full px-3 py-2 text-xs font-medium text-blue-600 ring-1 ring-dashed ring-blue-300 rounded-md hover:bg-blue-50"
            >
              + Add step
            </button>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
          <span className="text-xs text-red-600">{error}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save workflow"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkflowsPanel({ workflows }: { workflows: EvalWorkflowRow[] }) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sorted = [...workflows].sort((a, b) => stringCompare(a.name, b.name));

  const deleteWorkflow = async (workflowId: string) => {
    if (!window.confirm("Delete this workflow? Existing runs and their logs are kept.")) return;
    setError(null);
    const res = await fetch(`/api/evals/workflows/${encodeURIComponent(workflowId)}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      setError(data.error ?? `Delete failed (${res.status})`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {error ? <span className="text-xs text-red-600">{error}</span> : <span />}
        <button
          onClick={() => setEditor({ workflowId: null, name: "", description: "", defaultModel: "anthropic/claude-sonnet-4.6", steps: [{ ...EMPTY_STEP }] })}
          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
        >
          + New workflow
        </button>
      </div>

      {sorted.length === 0 && (
        <div className="bg-white rounded-lg ring-1 ring-gray-200 p-10 text-center text-sm text-gray-400">
          No workflows yet. The default Hexclave eval workflow is seeded automatically on first load.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {sorted.map(workflow => {
          const steps = safeParseSteps(workflow.stepsJson);
          return (
            <div key={String(workflow.id)} className="bg-white rounded-lg ring-1 ring-gray-200 p-4 flex flex-col gap-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{workflow.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{workflow.description}</p>
              </div>
              <div className="text-[11px] text-gray-400 flex items-center gap-3 flex-wrap">
                <span className="font-mono">{workflow.defaultModel}</span>
                <span>{steps.length} steps</span>
                <span>updated {format(toDate(workflow.updatedAt), "MMM d HH:mm")}</span>
              </div>
              <div className="text-[11px] text-gray-500">
                {steps.map((s, i) => <span key={i} className="inline-block bg-gray-100 rounded px-1.5 py-0.5 mr-1 mb-1">{i + 1}. {s.name}</span>)}
              </div>
              <div className="flex gap-2 mt-auto pt-1">
                <button
                  onClick={() => setEditor({ workflowId: workflow.workflowId, name: workflow.name, description: workflow.description, defaultModel: workflow.defaultModel, steps: steps.length > 0 ? steps : [{ ...EMPTY_STEP }] })}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  Edit
                </button>
                <button
                  onClick={() => setEditor({ workflowId: null, name: `${workflow.name} (copy)`, description: workflow.description, defaultModel: workflow.defaultModel, steps })}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  Duplicate
                </button>
                <button
                  onClick={() => void deleteWorkflow(workflow.workflowId)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editor && (
        <WorkflowEditorModal
          initial={editor}
          onClose={() => setEditor(null)}
          onSaved={() => setError(null)}
        />
      )}
    </div>
  );
}
