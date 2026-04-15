"use client";

import { cn } from "@/lib/utils";
import { memo, useEffect, useRef, useState } from "react";

const STATUS_MESSAGES = [
  "Understanding your query...",
  "Analyzing project structure...",
  "Writing dashboard code...",
  "Generating components...",
  "Assembling layout...",
];

const CHARS_PER_FRAME = 8;
const FRAME_INTERVAL_MS = 16;

function highlightCode(code: string): React.ReactNode[] {
  const lines = code.split("\n");
  return lines.map((line, i) => (
    <div key={i} className="whitespace-pre">
      {highlightLine(line)}
    </div>
  ));
}

function highlightLine(line: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  const regex = /(\/\/.*$|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b(?:import|export|from|const|let|var|function|return|if|else|for|while|async|await|new|class|extends|typeof|interface|type)\b|\b\d+(?:\.\d+)?\b|<\/?[A-Z][A-Za-z0-9.]*|[{}()[\];,.])/gm;

  let lastIndex = 0;
  let match;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("//") || token.startsWith("/*")) {
      tokens.push(<span key={`${lastIndex}-c`} className="text-zinc-400 dark:text-zinc-500">{token}</span>);
    } else if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
      tokens.push(<span key={`${lastIndex}-s`} className="text-green-600 dark:text-green-400">{token}</span>);
    } else if (/^<\/?[A-Z]/.test(token)) {
      tokens.push(<span key={`${lastIndex}-j`} className="text-amber-600 dark:text-amber-400">{token}</span>);
    } else if (/^\b(?:import|export|from|const|let|var|function|return|if|else|for|while|async|await|new|class|extends|typeof|interface|type)\b$/.test(token)) {
      tokens.push(<span key={`${lastIndex}-k`} className="text-blue-600 dark:text-blue-400">{token}</span>);
    } else if (/^\d/.test(token)) {
      tokens.push(<span key={`${lastIndex}-n`} className="text-orange-600 dark:text-orange-400">{token}</span>);
    } else {
      tokens.push(token);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < line.length) {
    tokens.push(line.slice(lastIndex));
  }
  return tokens;
}

export const StreamingCodeViewer = memo(function StreamingCodeViewer({
  code,
  isStreaming,
  onComplete,
}: {
  code: string,
  isStreaming: boolean,
  onComplete?: () => void,
}) {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const containerRef = useRef<HTMLDivElement>(null);

  const [visibleLen, setVisibleLen] = useState(0);
  const targetRef = useRef(0);

  useEffect(() => {
    targetRef.current = code.length;
  }, [code]);

  useEffect(() => {
    if (code.length === 0) {
      setVisibleLen(0);
      targetRef.current = 0;
    }
  }, [code.length]);

  const isTyping = visibleLen < code.length;
  useEffect(() => {
    if (!isTyping) return;
    const interval = setInterval(() => {
      setVisibleLen((prev) => {
        const target = targetRef.current;
        if (prev >= target) return prev;
        return Math.min(prev + CHARS_PER_FRAME, target);
      });
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isTyping]);

  const firedCompleteRef = useRef(false);
  useEffect(() => {
    if (!isTyping && !isStreaming && code.length > 0 && !firedCompleteRef.current) {
      firedCompleteRef.current = true;
      onCompleteRef.current?.();
    }
  }, [isTyping, isStreaming, code.length]);

  useEffect(() => {
    if (code.length === 0) {
      firedCompleteRef.current = false;
    }
  }, [code.length]);

  const visibleCode = code.slice(0, visibleLen);
  const hasVisible = visibleLen > 0;
  const hasCode = code.length > 0;
  const showCursor = isStreaming || isTyping;

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleCode]);

  const [statusIndex, setStatusIndex] = useState(0);
  useEffect(() => {
    if (hasCode) return;
    const interval = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % STATUS_MESSAGES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [hasCode]);

  useEffect(() => {
    if (!hasCode) setStatusIndex(0);
  }, [hasCode]);

  return (
    <div className="flex h-full w-full flex-col rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-white/[0.06]">
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-100/80 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-white/[0.06]">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
        </div>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono ml-1">Dashboard.tsx</span>
      </div>

      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden p-3 font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300"
      >
        {hasVisible ? (
          <div>
            {highlightCode(visibleCode)}
            {showCursor && (
              <span className={cn(
                "inline-block w-[6px] h-[14px] bg-cyan-500 dark:bg-cyan-400 ml-0.5 align-middle",
                "animate-pulse"
              )} />
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" style={{ animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 transition-opacity duration-300">
                {STATUS_MESSAGES[statusIndex]}
              </span>
            </div>
          </div>
        )}
      </div>

      {showCursor && hasVisible && (
        <div className="h-8 bg-gradient-to-t from-cyan-500/[0.04] dark:from-cyan-500/[0.06] to-transparent pointer-events-none" />
      )}
    </div>
  );
});
