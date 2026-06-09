"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "../markdown-components";
import { ModelPicker } from "./ModelPicker";

const SESSION_KEY = "eval-chat-session-id";
const DEFAULT_CHAT_MODEL = "anthropic/claude-sonnet-4.6";

type ChatItem =
  | { kind: "user", text: string }
  | { kind: "assistant", text: string }
  | { kind: "tool_use", name: string, input: unknown }
  | { kind: "tool_result", content: string }
  | { kind: "error", message: string };

function ToolChip({ name, input }: { name: string, input: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md ring-1 ring-blue-200 bg-blue-50/50 text-xs">
      <button onClick={() => setOpen(o => !o)} className="w-full text-left px-2.5 py-1 flex items-center gap-1.5 text-gray-700">
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
        <span className="font-medium">🔧 {name.replace("mcp__evals__", "")}</span>
      </button>
      {open && (
        <pre className="px-2.5 pb-2 font-mono text-[11px] text-gray-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
          {JSON.stringify(input ?? {}, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ToolResultLine({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const preview = content.length > 100 ? content.slice(0, 100) + "…" : content;
  return (
    <button onClick={() => setOpen(o => !o)} className="block w-full text-left">
      <span className="font-mono text-[10px] text-gray-400">← {open ? "" : preview || "(empty)"}</span>
      {open && <pre className="font-mono text-[11px] text-gray-600 whitespace-pre-wrap max-h-48 overflow-y-auto bg-gray-50 rounded p-1.5 mt-0.5">{content}</pre>}
    </button>
  );
}

export function EvalChat() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL);
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSessionId(localStorage.getItem(SESSION_KEY));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const newChat = () => {
    abortRef.current?.abort();
    localStorage.removeItem(SESSION_KEY);
    setSessionId(null);
    setItems([]);
    setStreaming(false);
  };

  const send = async () => {
    const message = input.trim();
    if (message === "" || streaming) return;
    setInput("");
    setItems(prev => [...prev, { kind: "user", text: message }]);
    setStreaming(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await fetch("/api/evals/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, sessionId: sessionId ?? undefined, model }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Chat request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data: ")) continue;
          let event: { type: string } & Record<string, unknown>;
          try {
            event = JSON.parse(line.slice(6)) as typeof event;
          } catch {
            continue;
          }
          if (event.type === "session" && typeof event.sessionId === "string") {
            localStorage.setItem(SESSION_KEY, event.sessionId);
            setSessionId(event.sessionId);
          } else if (event.type === "assistant_text" && typeof event.text === "string") {
            const text = event.text;
            setItems(prev => [...prev, { kind: "assistant", text }]);
          } else if (event.type === "tool_use") {
            setItems(prev => [...prev, { kind: "tool_use", name: String(event.name ?? "tool"), input: event.input }]);
          } else if (event.type === "tool_result" && typeof event.content === "string") {
            const content = event.content;
            setItems(prev => [...prev, { kind: "tool_result", content }]);
          } else if (event.type === "error" && typeof event.message === "string") {
            const message_ = event.message;
            setItems(prev => [...prev, { kind: "error", message: message_ }]);
          }
          // "result" duplicates the final assistant_text; "done" ends the stream.
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setItems(prev => [...prev, { kind: "error", message: error instanceof Error ? error.message : String(error) }]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const lastItem = items.at(-1);
  const showThinking = streaming && (!lastItem || lastItem.kind === "user" || lastItem.kind === "tool_result" || lastItem.kind === "tool_use");

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-700 shrink-0">Control agent</span>
        <ModelPicker value={model} onChange={setModel} className="flex-1" />
        <button
          onClick={newChat}
          className="px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-800 shrink-0"
        >
          New chat
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-gray-400 pt-8 text-center px-4 space-y-2">
            <p>Manage eval workflows and runs in plain language.</p>
            <p>Try: “run the default workflow on sonnet and gpt-5.5, 2 runs each”, “why did the last run fail?”, or “exec ls -la in run …”.</p>
          </div>
        )}
        {items.map((item, i) => {
          switch (item.kind) {
            case "user": {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] bg-blue-50 ring-1 ring-blue-100 rounded-lg px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap">{item.text}</div>
                </div>
              );
            }
            case "assistant": {
              return (
                <div key={i} className="max-w-[95%] prose prose-sm text-sm text-gray-800">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{item.text}</ReactMarkdown>
                </div>
              );
            }
            case "tool_use": {
              return <ToolChip key={i} name={item.name} input={item.input} />;
            }
            case "tool_result": {
              return <ToolResultLine key={i} content={item.content} />;
            }
            case "error": {
              return <div key={i} className="text-xs text-red-600 bg-red-50 ring-1 ring-red-200 rounded-md px-2.5 py-1.5">{item.message}</div>;
            }
          }
        })}
        {showThinking && <div className="text-xs text-gray-400 animate-pulse">thinking…</div>}
      </div>

      <div className="border-t border-gray-200 p-2">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                runAsynchronously(send);
              }
            }}
            rows={2}
            placeholder="Message the control agent… (Enter to send)"
            className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <button
            onClick={() => {
              if (streaming) {
                abortRef.current?.abort();
              } else {
                runAsynchronously(send);
              }
            }}
            disabled={!streaming && input.trim() === ""}
            className={clsx(
              "px-3 py-1.5 text-xs font-medium rounded-md text-white disabled:opacity-50",
              streaming ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {streaming ? "Stop" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
