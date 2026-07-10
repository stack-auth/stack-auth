"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ScriptStep =
  | { kind: "wait", ms: number }
  | { kind: "line", text: string, level?: "info" | "success" | "warn" }
  | { kind: "progress", id: string, label: string, status: "running" | "done" };

export type DemoScriptState = {
  lines: { id: string, text: string, level: "info" | "success" | "warn" }[],
  progress: Map<string, { label: string, status: "running" | "done" }>,
  finished: boolean,
};

export function useDemoScript(steps: ScriptStep[], autoStart = false) {
  const [state, setState] = useState<DemoScriptState>({
    lines: [],
    progress: new Map(),
    finished: false,
  });
  const timersRef = useRef<number[]>([]);
  const startedRef = useRef(false);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) {
      window.clearTimeout(timer);
    }
    timersRef.current = [];
  }, []);

  const start = useCallback(() => {
    clearTimers();
    startedRef.current = true;
    setState({ lines: [], progress: new Map(), finished: false });

    let cumulativeMs = 0;
    steps.forEach((step, index) => {
      if (step.kind === "wait") {
        cumulativeMs += step.ms;
        return;
      }
      const delay = cumulativeMs;
      const timer = window.setTimeout(() => {
        setState((prev) => {
          if (step.kind === "line") {
            return {
              ...prev,
              lines: [...prev.lines, { id: `line-${index}`, text: step.text, level: step.level ?? "info" }],
            };
          }
          const progress = new Map(prev.progress);
          progress.set(step.id, { label: step.label, status: step.status });
          return { ...prev, progress };
        });
      }, delay);
      timersRef.current.push(timer);
      cumulativeMs += 80;
    });

    const doneTimer = window.setTimeout(() => {
      setState((prev) => ({ ...prev, finished: true }));
    }, cumulativeMs + 100);
    timersRef.current.push(doneTimer);
  }, [clearTimers, steps]);

  const reset = useCallback(() => {
    clearTimers();
    startedRef.current = false;
    setState({ lines: [], progress: new Map(), finished: false });
  }, [clearTimers]);

  useEffect(() => {
    if (autoStart && !startedRef.current) {
      start();
    }
    return clearTimers;
  }, [autoStart, start, clearTimers]);

  return { state, start, reset };
}
