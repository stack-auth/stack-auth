"use client";

import { useEffect, useMemo, useRef } from "react";
import type { BuildLogLine } from "../fixtures/types";
import { useDemoScript, type ScriptStep } from "../use-demo-scripts";
import { CxChip, CxPanel, StatusDot, cx } from "./ui-kit";

export type BuildLogViewerProps = {
  buildLog: BuildLogLine[],
  running: boolean,
};

export function BuildLogViewer({ buildLog, running }: BuildLogViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const { steps, lineSteps } = useMemo(() => {
    const nextSteps: ScriptStep[] = [];
    const nextLineSteps = new Map<string, BuildLogLine["step"]>();

    for (const line of buildLog) {
      nextSteps.push({ kind: "wait", ms: line.delayMs });
      const scriptIndex = nextSteps.length;
      nextSteps.push({ kind: "line", text: line.text, level: line.level });
      nextLineSteps.set(`line-${scriptIndex}`, line.step);
    }

    return { steps: nextSteps, lineSteps: nextLineSteps };
  }, [buildLog]);
  const { state } = useDemoScript(steps, running);
  const visibleLines = running
    ? state.lines.map((line) => {
      const step = lineSteps.get(line.id);
      if (step == null) {
        throw new Error(`Build log line "${line.id}" has no matching step.`);
      }
      return { ...line, step };
    })
    : buildLog.map((line) => ({
      id: line.id,
      text: line.text,
      level: line.level ?? "info",
      step: line.step,
    }));

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport != null) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [visibleLines.length]);

  return (
    <CxPanel
      title="Build"
      meta={
        <div className="flex items-center gap-2">
          <StatusDot status={running && !state.finished ? "warn" : "ok"} />
          <span className={cx.mono}>{running && !state.finished ? "running" : "ready"}</span>
        </div>
      }
      bodyClassName="p-0"
    >
      <div
        ref={viewportRef}
        className="max-h-72 min-h-44 overflow-y-auto bg-[#0b0b0f] px-4 py-3 font-mono text-[11px] leading-5 text-[#c8c7d1]"
        aria-live="polite"
      >
        {visibleLines.length === 0 ? (
          <div className="flex min-h-36 items-center justify-center text-[#6b7280]">
            No build output for this release.
          </div>
        ) : (
          <div className="space-y-1.5">
            {visibleLines.map((line) => (
              <div key={line.id} className="flex items-start gap-3">
                <span className="w-14 shrink-0 text-[#6b7280]">{line.step}</span>
                <span
                  className={
                    line.level === "success"
                      ? "text-[#7dcea8]"
                      : line.level === "warn"
                        ? "text-amber-300"
                        : "text-[#c8c7d1]"
                  }
                >
                  {line.text}
                </span>
              </div>
            ))}
            {running && !state.finished && (
              <span className="inline-block h-3.5 w-1.5 animate-pulse bg-[#7c6cff] motion-reduce:animate-none" />
            )}
          </div>
        )}
      </div>
      {!running && (
        <div className="border-t border-black/[0.06] px-4 py-2 dark:border-white/[0.06]">
          <CxChip tone="ok">All checks passed</CxChip>
        </div>
      )}
    </CxPanel>
  );
}
