"use client";

import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EvalWorklogRow } from "../../types";
import { markdownComponents } from "../markdown-components";

const RENDER_CAP = 400;

// The worklog stores one row per AI SDK v5 `fullStream` part (kind === part.type),
// plus a few non-stream kinds (meta / stdout / stderr / result). Rendered raw,
// that's a flood of `text-delta` / `tool-call` / `text-start` noise. We instead
// fold the stream back into meaningful blocks: deltas coalesce into one message,
// reasoning groups, and every tool call is paired with its result inline.

type ToolEntry = {
  id: string;
  kind: "tool";
  name: string;
  input: unknown;
  inputText: string; // streamed partial JSON, fallback when `input` is absent
  output: string | null;
  isError: boolean;
  dynamic: boolean;
  done: boolean;
};

type Entry =
  | { id: string, kind: "text", text: string }
  | { id: string, kind: "reasoning", text: string }
  | ToolEntry
  | { id: string, kind: "step", stepName: string, model: string, prompt: string }
  | { id: string, kind: "result", text: string, costUsd: number | null, durationMs: number | null, numTurns: number | null }
  | { id: string, kind: "log", stream: "stdout" | "stderr", text: string }
  | { id: string, kind: "error", text: string }
  | { id: string, kind: "note", label: string };

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// Tool outputs arrive in a few shapes (raw string, AI SDK content parts, JSON
// values). Collapse any of them to readable text without ever dumping `[object]`.
function extractText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(extractText).join("");
  const o = v as Record<string, unknown>;
  if (typeof o.text === "string") return o.text;
  if (typeof o.value === "string") return o.value;
  if (typeof o.output === "string") return o.output;
  if ("value" in o) return safeJson(o.value);
  return safeJson(o);
}

const HIDDEN_KINDS = new Set([
  "start", "finish", "start-step", "finish-step", "abort",
  "raw", "source", "file", "reasoning-file", "tool-input-end",
  "text-end", "reasoning-end",
]);

function foldRows(rows: EvalWorklogRow[]): Entry[] {
  const out: Entry[] = [];
  const textById = new Map<string, Extract<Entry, { kind: "text" }>>();
  const reasoningById = new Map<string, Extract<Entry, { kind: "reasoning" }>>();
  const toolById = new Map<string, ToolEntry>();

  const parse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s) as unknown;
      return v && typeof v === "object" ? v as Record<string, unknown> : null;
    } catch {
      return null;
    }
  };
  const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

  const newTool = (id: string, p: Record<string, unknown> | null): ToolEntry => ({
    id, kind: "tool",
    name: str(p?.toolName, "tool"),
    input: p && "input" in p ? p.input : undefined,
    inputText: "",
    output: null,
    isError: false,
    dynamic: p?.dynamic === true,
    done: false,
  });

  for (const row of rows) {
    const key = String(row.id);
    const p = parse(row.content);

    if (HIDDEN_KINDS.has(row.kind)) continue;

    switch (row.kind) {
      case "meta": {
        if (p?.type === "eval_step_started") {
          out.push({ id: key, kind: "step", stepName: str(p.stepName, "Step"), model: str(p.model), prompt: str(p.prompt) });
        } else {
          out.push({ id: key, kind: "note", label: str(p?.type, "meta") });
        }
        break;
      }
      case "stdout":
      case "stderr": {
        const last = out.length > 0 ? out[out.length - 1] : null;
        if (last && last.kind === "log" && last.stream === row.kind) {
          last.text += (last.text.endsWith("\n") ? "" : "\n") + row.content;
        } else {
          out.push({ id: key, kind: "log", stream: row.kind, text: row.content });
        }
        break;
      }
      case "result": {
        out.push({
          id: key, kind: "result",
          text: typeof p?.result === "string" ? p.result : safeJson(p?.result ?? ""),
          costUsd: typeof p?.total_cost_usd === "number" ? p.total_cost_usd : null,
          durationMs: typeof p?.duration_ms === "number" ? p.duration_ms : null,
          numTurns: typeof p?.num_turns === "number" ? p.num_turns : null,
        });
        break;
      }
      case "text-start": {
        const e: Extract<Entry, { kind: "text" }> = { id: key, kind: "text", text: "" };
        textById.set(str(p?.id, key), e);
        out.push(e);
        break;
      }
      case "text-delta": {
        const id = str(p?.id, key);
        let e = textById.get(id);
        if (!e) {
          e = { id: key, kind: "text", text: "" };
          textById.set(id, e);
          out.push(e);
        }
        e.text += str(p?.text);
        break;
      }
      case "reasoning-start": {
        const e: Extract<Entry, { kind: "reasoning" }> = { id: key, kind: "reasoning", text: "" };
        reasoningById.set(str(p?.id, key), e);
        out.push(e);
        break;
      }
      case "reasoning-delta": {
        const id = str(p?.id, key);
        let e = reasoningById.get(id);
        if (!e) {
          e = { id: key, kind: "reasoning", text: "" };
          reasoningById.set(id, e);
          out.push(e);
        }
        e.text += str(p?.text);
        break;
      }
      case "tool-input-start": {
        const id = str(p?.id, key);
        const e = newTool(key, p);
        toolById.set(id, e);
        out.push(e);
        break;
      }
      case "tool-input-delta": {
        const e = toolById.get(str(p?.id));
        if (e) e.inputText += str(p?.delta);
        break;
      }
      case "tool-call": {
        const id = str(p?.toolCallId, key);
        let e = toolById.get(id);
        if (!e) {
          e = newTool(key, p);
          toolById.set(id, e);
          out.push(e);
        }
        e.name = str(p?.toolName, e.name);
        if (p && "input" in p) e.input = p.input;
        e.dynamic = p?.dynamic === true;
        if (p?.invalid === true && p.error != null) {
          e.isError = true;
          e.output = extractText(p.error);
          e.done = true;
        }
        break;
      }
      case "tool-result": {
        const id = str(p?.toolCallId, key);
        let e = toolById.get(id);
        if (!e) {
          e = newTool(key, p);
          toolById.set(id, e);
          out.push(e);
        }
        if (e.input === undefined && p && "input" in p) e.input = p.input;
        e.output = extractText(p?.output);
        e.done = true;
        break;
      }
      case "tool-error": {
        const id = str(p?.toolCallId, key);
        let e = toolById.get(id);
        if (!e) {
          e = newTool(key, p);
          toolById.set(id, e);
          out.push(e);
        }
        if (e.input === undefined && p && "input" in p) e.input = p.input;
        e.output = extractText(p?.error);
        e.isError = true;
        e.done = true;
        break;
      }
      case "error": {
        out.push({ id: key, kind: "error", text: extractText(p?.error ?? p ?? row.content) });
        break;
      }
      default: {
        // Legacy Anthropic-format rows (older runs): map content blocks to entries.
        const legacy = foldLegacyBlocks(p, key);
        if (legacy.length > 0) out.push(...legacy);
        else out.push({ id: key, kind: "note", label: str(p?.type, row.kind) });
      }
    }
  }

  return out;
}

// Backward-compat for runs logged in the old Anthropic Messages shape
// (`{ message: { content: [...] } }`) rather than AI SDK stream parts.
function foldLegacyBlocks(message: Record<string, unknown> | null, key: string): Entry[] {
  const inner = message?.message as { content?: unknown } | undefined;
  const blocks = Array.isArray(inner?.content) ? inner.content : [];
  const entries: Entry[] = [];
  blocks.forEach((rawBlock, i) => {
    const block = rawBlock as Record<string, unknown>;
    const id = `${key}-${i}`;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      entries.push({ id, kind: "text", text: block.text });
    } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim() !== "") {
      entries.push({ id, kind: "reasoning", text: block.thinking });
    } else if (block.type === "tool_use") {
      entries.push({ id, kind: "tool", name: String(block.name ?? "tool"), input: block.input, inputText: "", output: null, isError: false, dynamic: false, done: true });
    } else if (block.type === "tool_result") {
      entries.push({ id, kind: "tool", name: "result", input: undefined, inputText: "", output: extractText(block.content), isError: block.is_error === true, dynamic: false, done: true });
    }
  });
  return entries;
}

// Short, human-readable hint from a tool's input (command, path, pattern, url…).
function toolHint(input: unknown, inputText: string): string {
  const o = (input && typeof input === "object" ? input : null) as Record<string, unknown> | null;
  const pick = o?.command ?? o?.file_path ?? o?.path ?? o?.pattern ?? o?.query ?? o?.url ?? o?.prompt ?? o?.description;
  const raw = typeof pick === "string" ? pick : inputText;
  return raw.replace(/\s+/g, " ").trim().slice(0, 140);
}

function inputBody(input: unknown, inputText: string): string {
  if (input !== undefined) return safeJson(input);
  if (inputText.trim() === "") return "";
  try {
    return safeJson(JSON.parse(inputText));
  } catch {
    return inputText;
  }
}

function ToolBlock({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false);
  const hint = toolHint(entry.input, entry.inputText);
  const body = inputBody(entry.input, entry.inputText);
  const outPreview = entry.output ? entry.output.replace(/\s+/g, " ").trim().slice(0, 200) : "";

  return (
    <div className={clsx(
      "rounded-md ring-1 text-xs overflow-hidden",
      entry.isError ? "ring-red-200 bg-red-50/60" : "ring-blue-100 bg-blue-50/40",
    )}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 min-w-0 hover:bg-black/[0.02]"
      >
        <span className="text-gray-300 shrink-0 w-3">{open ? "▾" : "▸"}</span>
        <span className={clsx(
          "shrink-0 inline-flex items-center rounded px-1.5 py-0.5 font-mono font-medium text-[10px]",
          entry.isError ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700",
        )}>
          {entry.name}
        </span>
        {hint && <span className="font-mono text-[11px] text-gray-500 truncate">{hint}</span>}
        <span className="ml-auto shrink-0 pl-1">
          {!entry.done
            ? <span className="text-[10px] text-amber-500">running…</span>
            : entry.isError
              ? <span className="text-red-500">✗</span>
              : <span className="text-emerald-500">✓</span>}
        </span>
      </button>
      {!open && entry.done && outPreview && (
        <div className="px-2.5 pb-1.5 pl-7">
          <span className={clsx("font-mono text-[11px] truncate block", entry.isError ? "text-red-500" : "text-gray-400")}>
            → {outPreview}
          </span>
        </div>
      )}
      {open && (
        <div className="px-2.5 pb-2 pl-7 space-y-2">
          {body && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Input</div>
              <pre className="font-mono text-[11px] text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto bg-white/70 rounded ring-1 ring-gray-200 p-2">{body}</pre>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">{entry.isError ? "Error" : "Output"}</div>
            <pre className={clsx(
              "font-mono text-[11px] whitespace-pre-wrap max-h-96 overflow-y-auto rounded ring-1 p-2",
              entry.isError ? "text-red-700 bg-red-50 ring-red-200" : "text-gray-700 bg-white/70 ring-gray-200",
            )}>
              {entry.output ?? (entry.done ? "(empty)" : "…")}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function Collapsible({ summary, children, tone }: { summary: React.ReactNode, children: React.ReactNode, tone: "gray" | "violet" | "red" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={clsx(
      "rounded-md ring-1 text-xs",
      tone === "gray" && "ring-gray-200 bg-gray-50",
      tone === "violet" && "ring-violet-200 bg-violet-50/40",
      tone === "red" && "ring-red-200 bg-red-50",
    )}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-2.5 py-1.5 flex items-center gap-1.5 text-gray-700 min-w-0"
      >
        <span className="text-gray-300 shrink-0">{open ? "▾" : "▸"}</span>
        {summary}
      </button>
      {open && <div className="px-2.5 pb-2 overflow-x-auto">{children}</div>}
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{text}</ReactMarkdown>;
}

function EntryBlock({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case "text": {
      if (entry.text.trim() === "") return null;
      return (
        <div className="prose prose-sm max-w-none text-sm text-gray-800 bg-white rounded-md ring-1 ring-gray-200 px-3 py-2">
          <Markdown text={entry.text} />
        </div>
      );
    }
    case "reasoning": {
      if (entry.text.trim() === "") return null;
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
            <Markdown text={entry.text} />
          </div>
        </Collapsible>
      );
    }
    case "tool": {
      return <ToolBlock entry={entry} />;
    }
    case "step": {
      return (
        <Collapsible
          tone="gray"
          summary={
            <span className="text-gray-600 min-w-0 flex items-baseline gap-2">
              <span className="font-medium text-gray-700 shrink-0">▶ {entry.stepName}</span>
              {entry.model && <span className="font-mono text-[11px] text-gray-400 truncate">{entry.model}</span>}
            </span>
          }
        >
          <div className="prose prose-sm max-w-none text-sm text-gray-800 pt-1">
            <Markdown text={entry.prompt} />
          </div>
        </Collapsible>
      );
    }
    case "result": {
      return (
        <div className="rounded-md ring-1 ring-emerald-300 bg-emerald-50 px-3 py-2">
          <div className="text-[11px] font-medium text-emerald-800 mb-1 flex items-center gap-2 flex-wrap">
            <span>Step result</span>
            {entry.costUsd !== null && <span className="font-mono text-emerald-600">${entry.costUsd.toFixed(4)}</span>}
            {entry.durationMs !== null && <span className="font-mono text-emerald-600">{(entry.durationMs / 1000).toFixed(1)}s</span>}
            {entry.numTurns !== null && <span className="font-mono text-emerald-600">{entry.numTurns} turns</span>}
          </div>
          <div className="prose prose-sm max-w-none text-sm text-gray-800">
            <Markdown text={entry.text} />
          </div>
        </div>
      );
    }
    case "log": {
      const long = entry.text.length > 600;
      if (long) {
        const preview = entry.text.slice(0, 120).replace(/\s+/g, " ").trim();
        return (
          <Collapsible
            tone={entry.stream === "stderr" ? "red" : "gray"}
            summary={
              <span className="min-w-0 flex items-baseline gap-1.5">
                <span className={clsx("font-medium shrink-0 text-[11px]", entry.stream === "stderr" ? "text-red-600" : "text-gray-500")}>{entry.stream}</span>
                <span className="font-mono text-[11px] text-gray-400 truncate">{preview}…</span>
              </span>
            }
          >
            <pre className="font-mono text-[11px] text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto pt-1">{entry.text}</pre>
          </Collapsible>
        );
      }
      return (
        <pre className={clsx(
          "font-mono text-[11px] whitespace-pre-wrap px-2 py-1 rounded bg-gray-50 ring-1 ring-gray-100",
          entry.stream === "stderr" ? "text-red-600" : "text-gray-500",
        )}>{entry.text}</pre>
      );
    }
    case "error": {
      return (
        <div className="rounded-md ring-1 ring-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 whitespace-pre-wrap font-mono">
          {entry.text}
        </div>
      );
    }
    case "note": {
      return <div className="text-[11px] text-gray-300 px-1.5 truncate">· {entry.label}</div>;
    }
  }
}

export function WorklogViewer({ rows }: { rows: EvalWorklogRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const [following, setFollowing] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const entries = useMemo(() => foldRows(rows), [rows]);

  const summary = useMemo(() => {
    let tools = 0, messages = 0, steps = 0;
    for (const e of entries) {
      if (e.kind === "tool") tools++;
      else if (e.kind === "text") messages++;
      else if (e.kind === "step") steps++;
    }
    return { tools, messages, steps };
  }, [entries]);

  const visible = showAll || entries.length <= RENDER_CAP ? entries : entries.slice(entries.length - RENDER_CAP);

  useEffect(() => {
    const el = containerRef.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [entries.length, following]);

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
      <div className="flex items-center gap-3 mb-1.5 text-[11px] text-gray-400 px-0.5">
        {summary.steps > 0 && <span>{summary.steps} step{summary.steps === 1 ? "" : "s"}</span>}
        <span>{summary.messages} message{summary.messages === 1 ? "" : "s"}</span>
        <span>{summary.tools} tool call{summary.tools === 1 ? "" : "s"}</span>
      </div>
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="space-y-1.5 max-h-[60vh] overflow-y-auto rounded-md bg-gray-50/70 ring-1 ring-gray-200 p-2"
      >
        {!showAll && entries.length > RENDER_CAP && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="w-full text-center text-xs text-blue-600 hover:text-blue-700 py-1"
          >
            Show {entries.length - RENDER_CAP} earlier entries
          </button>
        )}
        {visible.map(entry => <EntryBlock key={entry.id} entry={entry} />)}
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
