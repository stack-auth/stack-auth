"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

export type ModelInfo = {
  id: string,
  name: string,
  description: string,
  contextLength: number | null,
  pricing: { prompt: string, completion: string } | null,
};

export function formatContextLength(contextLength: number | null): string | null {
  if (contextLength === null) return null;
  if (contextLength >= 1_000_000) return `${(contextLength / 1_000_000).toFixed(contextLength % 1_000_000 === 0 ? 0 : 1)}M ctx`;
  if (contextLength >= 1000) return `${Math.round(contextLength / 1000)}k ctx`;
  return `${contextLength} ctx`;
}

export function formatPromptPrice(pricing: { prompt: string, completion: string } | null): string | null {
  if (!pricing) return null;
  const perToken = Number(pricing.prompt);
  if (!Number.isFinite(perToken)) return null;
  const perMillion = perToken * 1_000_000;
  return `$${perMillion < 1 ? perMillion.toFixed(3) : perMillion.toFixed(2)}/M in`;
}

/**
 * Debounced (300ms) model search against /api/evals/models.
 */
export function useModelSearch(search: string) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      const load = async () => {
        const res = await fetch(`/api/evals/models?search=${encodeURIComponent(search)}&limit=50`);
        const data = await res.json() as { models?: ModelInfo[], error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? `Request failed (${res.status})`);
          setModels([]);
        } else {
          setError(null);
          setModels(data.models ?? []);
        }
        setLoading(false);
      };
      load().catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setModels([]);
        setLoading(false);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  return { models, loading, error };
}

export function ModelResultRow({ model, onPick }: { model: ModelInfo, onPick: (id: string) => void }) {
  const ctx = formatContextLength(model.contextLength);
  const price = formatPromptPrice(model.pricing);
  return (
    <button
      type="button"
      onClick={() => onPick(model.id)}
      className="w-full text-left px-3 py-1.5 hover:bg-blue-50 flex items-baseline gap-2"
    >
      <span className="font-mono text-xs text-gray-900 shrink-0">{model.id}</span>
      <span className="text-xs text-gray-500 truncate flex-1">{model.name}</span>
      {ctx && <span className="text-[10px] text-gray-400 shrink-0">{ctx}</span>}
      {price && <span className="text-[10px] text-gray-400 shrink-0">{price}</span>}
    </button>
  );
}

/**
 * Single-select model input: free-text editable, with a dropdown of OpenRouter
 * search results. The raw input value is the selected model slug.
 */
export function ModelPicker({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string,
  onChange: (value: string) => void,
  placeholder?: string,
  className?: string,
}) {
  const [open, setOpen] = useState(false);
  const { models, loading, error } = useModelSearch(value);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  return (
    <div ref={rootRef} className={clsx("relative", className)}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? "openrouter/model-slug"}
        className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-white rounded-md shadow-lg ring-1 ring-gray-200">
          {error && <div className="px-3 py-2 text-xs text-red-600">{error}</div>}
          {!error && loading && models.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">Searching models...</div>
          )}
          {!error && !loading && models.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">No models found. Free-text slugs are allowed.</div>
          )}
          {models.map(model => (
            <ModelResultRow
              key={model.id}
              model={model}
              onPick={(id) => {
                onChange(id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
