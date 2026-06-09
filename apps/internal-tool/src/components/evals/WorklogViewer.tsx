"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EvalWorklogRow } from "../../types";
import { markdownComponents } from "../markdown-components";

const RENDER_CAP = 500;

type ParsedEntry =
  | { type: "assistant_text", text: string }
  | { type: "thinking", text: string }
  | { type: "redacted_thinking" }
  | { type: "tool_use", name: string, input: unknown }
  | { type: "tool_result", text: string, isError: boolean }
  | { type: "result", text: string, costUsd: number | null, durationMs: number | null, numTurns: number | null }
  | { type: "step_started", stepName: string, model: string, prompt: string }
  | { type: "event", label: string }
  | { type: "plain", kind: string, text: string };

function parseEntry(row: EvalWorklogRow): ParsedEntry[] {
  if (row.kind === "meta") {
    // meta entries are JSON; the step-start one carries the rendered prompt.
    try {
      const m = JSON.parse(row.content) as Record<string, unknown>;
      if (m.type === "eval_step_started") {
        return [{
          type: "step_started",
          stepName: typeof m.stepName === "string" ? m.stepName : "Step",
          model: typeof m.model === "string" ? m.model : "",
          prompt: typeof m.prompt === "string" ? m.prompt : "",
        }];
      }
    } catch {
      // fall through to plain
    }
    return [{ type: "plain", kind: row.kind, text: row.content }];
  }
  if (row.kind === "stdout" || row.kind === "stderr") {
    return [{ type: "plain", kind: row.kind, text: row.content }];
  }
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(row.content) as Record<string, unknown>;
  } catch {
    return [{ type: "plain", kind: row.kind, text: row.content }];
  }
  if (row.kind === "result") {
    return [{
      type: "result",
      text: typeof message.result === "string" ? message.result : JSON.stringify(message.result ?? ""),
      costUsd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : null,
      durationMs: typeof message.duration_ms === "number" ? message.duration_ms : null,
      numTurns: typeof message.num_turns === "number" ? message.num_turns : null,
    }];
  }
  if (row.kind === "system") {
    const subtype = typeof message.subtype === "string" ? message.subtype : "system";
    const model = typeof message.model === "string" ? ` · ${message.model}` : "";
    return [{ type: "event", label: `${subtype}${model}` }];
  }
  const inner = message.message as { content?: unknown } | undefined;
  const blocks = Array.isArray(inner?.content) ? inner.content : [];
  const parsed: ParsedEntry[] = [];
  for (const rawBlock of blocks) {
    const block = rawBlock as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      parsed.push({ type: "assistant_text", text: block.text });
    } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim() !== "") {
      parsed.push({ type: "thinking", text: block.thinking });
    } else if (block.type === "redacted_thinking") {
      parsed.push({ type: "redacted_thinking" });
    } else if (block.type === "tool_use") {
      parsed.push({ type: "tool_use", name: String(block.name ?? "tool"), input: block.input });
    } else if (block.type === "tool_result") {
      const content = block.content;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map(part => String((part as { text?: string }).text ?? "")).join("")
          : JSON.stringify(content ?? "");
      parsed.push({ type: "tool_result", text, isError: block.is_error === true });
    }
  }
  if (parsed.length === 0) {
    // Never dump raw JSON: collapse anything unrenderable to a compact event chip
    // labelled by its message type (e.g. "user", "assistant", "thinking_tokens").
    const label = typeof message.type === "string" ? message.type : row.kind;
    return [{ type: "event", label }];
  }
  return parsed;
}

function Collapsible({ summary, children, tone }: { summary: React.ReactNode, children: React.ReactNode, tone: "blue" | "gray" | "red" | "violet" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={clsx(
      "rounded-md ring-1 text-xs",
      tone === "blue" && "ring-blue-200 bg-blue-50/50",
      tone === "gray" && "ring-gray-200 bg-gray-50",
      tone === "red" && "ring-red-200 bg-red-50",
      tone === "violet" && "ring-violet-200 bg-violet-50/40",
    )}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-2.5 py-1.5 flex items-center gap-1.5 text-gray-700 min-w-0"
      >
        <span className="text-gray-400 shrink-0">{open ? "▾" : "▸"}</span>
        {summary}
      </button>
      {open && <div className="px-2.5 pb-2 overflow-x-auto">{children}</div>}
    </div>
  );
}

// Pull a short, human-readable hint out of a tool's input for the summary line
// (the command for Bash, the path for file tools, the pattern for search, etc.).
function toolSummary(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const pick = o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? o.prompt ?? o.description;
  if (typeof pick !== "string") return "";
  return pick.replace(/\s+/g, " ").trim().slice(0, 100);
}

function EntryBlock({ entry }: { entry: ParsedEntry }) {
  switch (entry.type) {
    case "assistant_text": {
      return (
        <div className="prose prose-sm max-w-none text-sm text-gray-800 bg-white rounded-md ring-1 ring-gray-200 px-3 py-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{entry.text}</ReactMarkdown>
        </div>
      );
    }
    case "thinking": {
      const preview = entry.text.replace(/\s+/g, " ").trim().slice(0, 120);
      return (
        <Collapsible
          tone="violet"
          summary={
            <span className="min-w-0 flex items-baseline gap-1.5">
              <span className="font-medium text-violet-700 shrink-0">Thinking</span>
              <span className="text-[11px] text-violet-400/90 truncate">{preview}</span>
            </span>
          }
        >
          <div className="prose prose-sm max-w-none text-[13px] text-gray-600 pt-1">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{entry.text}</ReactMarkdown>
          </div>
        </Collapsible>
      );
    }
    case "redacted_thinking": {
      return <div className="text-[11px] text-violet-400 px-1.5">• redacted thinking</div>;
    }
    case "tool_use": {
      const hint = toolSummary(entry.input);
      return (
        <Collapsible
          tone="blue"
          summary={
            <span className="min-w-0 flex items-baseline gap-1.5">
              <span className="font-medium text-blue-700 shrink-0">{entry.name}</span>
              {hint && <span className="font-mono text-[11px] text-blue-400 truncate">{hint}</span>}
            </span>
          }
        >
          <pre className="font-mono text-[11px] text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto">
            {JSON.stringify(entry.input ?? {}, null, 2)}
          </pre>
        </Collapsible>
      );
    }
    case "tool_result": {
      const preview = entry.text.length > 160 ? entry.text.slice(0, 160) + "…" : entry.text;
      return (
        <Collapsible
          tone={entry.isError ? "red" : "gray"}
          summary={<span className={clsx("font-mono text-[11px] truncate", entry.isError ? "text-red-700" : "text-gray-500")}>{entry.isError ? "✗ " : "← "}{preview || "(empty result)"}</span>}
        >
          <pre className="font-mono text-[11px] text-gray-700 whitespace-pre-wrap max-h-96 overflow-y-auto">
            {entry.text}
          </pre>
        </Collapsible>
      );
    }
    case "result": {
      return (
        <div className="rounded-md ring-1 ring-green-300 bg-green-50 px-3 py-2">
          <div className="text-[11px] font-medium text-green-800 mb-1">
            Step result
            {entry.costUsd !== null && <span className="ml-2 font-mono">${entry.costUsd.toFixed(4)}</span>}
            {entry.durationMs !== null && <span className="ml-2 font-mono">{(entry.durationMs / 1000).toFixed(1)}s</span>}
            {entry.numTurns !== null && <span className="ml-2 font-mono">{entry.numTurns} turns</span>}
          </div>
          <div className="prose prose-sm max-w-none text-sm text-gray-800">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{entry.text}</ReactMarkdown>
          </div>
        </div>
      );
    }
    case "step_started": {
      return (
        <Collapsible
          tone="gray"
          summary={
            <span className="text-gray-600">
              <span className="font-medium text-gray-700">▶ Step prompt</span>
              {entry.model && <span className="ml-2 font-mono text-[11px] text-gray-400">{entry.model}</span>}
            </span>
          }
        >
          <div className="prose prose-sm max-w-none text-sm text-gray-800 pt-1">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{entry.prompt}</ReactMarkdown>
          </div>
        </Collapsible>
      );
    }
    case "event": {
      // Low-signal lifecycle/token events: one subtle muted line, never JSON.
      return <div className="text-[11px] text-gray-400 px-1.5 truncate">· {entry.label}</div>;
    }
    case "plain": {
      // Long, non-JSON fallbacks (e.g. a stray oversized line) get collapsed so
      // they never become a wall of text.
      if (entry.text.length > 600) {
        const preview = entry.text.slice(0, 120).replace(/\s+/g, " ").trim();
        return (
          <Collapsible
            tone={entry.kind === "stderr" ? "red" : "gray"}
            summary={<span className="font-mono text-[11px] text-gray-500 truncate">{preview}…</span>}
          >
            <pre className="font-mono text-[11px] text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto">{entry.text}</pre>
          </Collapsible>
        );
      }
      return (
        <div className={clsx(
          "font-mono text-[11px] whitespace-pre-wrap px-1",
          entry.kind === "stderr" ? "text-red-600" : "text-gray-500",
        )}>
          {entry.text}
        </div>
      );
    }
  }
}

export function WorklogViewer({ rows }: { rows: EvalWorklogRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const [following, setFollowing] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const visible = showAll || rows.length <= RENDER_CAP ? rows : rows.slice(rows.length - RENDER_CAP);

  useEffect(() => {
    const el = containerRef.current;
    if (el && following) {
      el.scrollTop = el.scrollHeight;
    }
  }, [rows.length, following]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setFollowing(nearBottom);
  };

  if (rows.length === 0) {
    return <div className="text-xs text-gray-400 py-6 text-center">No worklog entries yet.</div>;
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="space-y-1.5 max-h-[60vh] overflow-y-auto rounded-md bg-gray-50 ring-1 ring-gray-200 p-2"
      >
        {!showAll && rows.length > RENDER_CAP && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="w-full text-center text-xs text-blue-600 hover:text-blue-700 py-1"
          >
            Show {rows.length - RENDER_CAP} earlier entries
          </button>
        )}
        {visible.map(row => (
          <div key={String(row.id)}>
            {parseEntry(row).map((entry, i) => <EntryBlock key={`${String(row.id)}-${i}`} entry={entry} />)}
          </div>
        ))}
      </div>
      {!following && (
        <button
          type="button"
          onClick={() => {
            setFollowing(true);
            const el = containerRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
          className="absolute bottom-2 right-3 px-2 py-1 text-[11px] font-medium bg-gray-900/80 text-white rounded-md"
        >
          ↓ Follow
        </button>
      )}
    </div>
  );
}
