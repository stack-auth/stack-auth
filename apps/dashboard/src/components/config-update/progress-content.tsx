'use client';

import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import React, { useEffect, useState } from "react";
import type { FileDiffProps } from "@pierre/diffs/react";
import type { FileDiffMetadata } from "@pierre/diffs";

import { currentEpochMsFromPerformance, type AgentStage } from "./shared";

type StepDef = { key: AgentStage, label: string, subLabel?: string };

const STAGE_STEPS: StepDef[] = [
  { key: "initializing_sandbox", label: "Initializing sandbox" },
  { key: "cloning_repo", label: "Cloning repo" },
  { key: "agent_making_changes", label: "Agent making changes", subLabel: "Editing config file" },
  { key: "awaiting_review", label: "Ready to review" },
];

function stageIndex(stage: AgentStage | null | undefined): number {
  if (stage == null) return -1;
  return STAGE_STEPS.findIndex((s) => s.key === stage);
}

/**
 * A compact stage tracker shown while the agent is running. Each step shows
 * elapsed seconds and a live activity sub-label for the active step.
 */
export function AgentStageProgress({
  stage,
  startedAt,
  activity,
}: {
  stage: AgentStage | null | undefined,
  /** Unix ms timestamp of when the run started (from the run's started_at). */
  startedAt: number,
  activity?: string | null,
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const performanceStartedAt = performance.now();
    const t = setInterval(() => setElapsedMs(performance.now() - performanceStartedAt), 1000);
    return () => clearInterval(t);
  }, []);

  const activeIdx = stageIndex(stage);
  // Server-side run timestamps are wall-clock epoch values. Once mounted, keep
  // the visible elapsed counter on a monotonic clock so local clock jumps don't
  // make the progress UI move backwards.
  const initialElapsedMs = Math.max(0, currentEpochMsFromPerformance() - startedAt);
  const overallElapsed = Math.max(0, Math.floor((initialElapsedMs + elapsedMs) / 1000));

  return (
    <div className="space-y-2">
      {STAGE_STEPS.map((step, idx) => {
        const isDone = idx < activeIdx;
        const isActive = idx === activeIdx;
        const isPending = idx > activeIdx;

        return (
          <div key={step.key} className="flex items-start gap-3">
            <div className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center shrink-0 transition-colors duration-150 ${
              isDone
                ? "bg-primary/15 text-primary"
                : isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-foreground/[0.06] text-muted-foreground"
            }`}>
              {isDone ? (
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <span className={`text-[9px] font-semibold leading-none ${isPending ? "opacity-40" : ""}`}>{idx + 1}</span>
              )}
            </div>

            <div className="flex-1 min-w-0 pt-0.5">
              <div className={`text-xs font-medium leading-snug flex items-center gap-2 ${
                isPending ? "text-muted-foreground opacity-50" : "text-foreground"
              }`}>
                <span>{step.label}</span>
                {isActive && (
                  <span className="text-muted-foreground font-normal tabular-nums">
                    {overallElapsed}s
                  </span>
                )}
              </div>
              {isActive && activity != null && activity.trim().length > 0 && (
                <div className="mt-1 font-mono text-[11px] text-muted-foreground leading-relaxed truncate">
                  <span className="text-primary mr-1.5">▸</span>
                  {activity.split("\n").filter((l) => l.trim()).at(-1)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ConfigAgentRunProgressContent({
  isCancelling,
  stage,
  startedAt,
  activity,
  errorMessage,
}: {
  isCancelling: boolean,
  stage: AgentStage | null | undefined,
  startedAt: number,
  activity?: string | null,
  errorMessage?: string | null,
}) {
  return (
    <div className="space-y-3">
      {isCancelling ? (
        <p className="text-sm text-muted-foreground">Cancelling the update and stopping the agent…</p>
      ) : (
        <AgentStageProgress stage={stage} startedAt={startedAt} activity={activity} />
      )}
      {errorMessage != null && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
    </div>
  );
}

/**
 * Lazy-loaded diff viewer. We parse the sandbox's full `git diff` into file
 * diffs, then render each file with Pierre's React renderer. `PatchDiff` only
 * accepts a single-file patch, while the config agent may legitimately edit
 * helpers/imported config files too.
 */
export function AgentDiffViewer({ diff }: { diff: string }) {
  const [renderer, setRenderer] = useState<{
    FileDiff: React.ComponentType<FileDiffProps<undefined>>,
    files: FileDiffMetadata[],
  } | null>(null);

  useEffect(() => {
    const cancelToken = { cancelled: false };
    runAsynchronously(async () => {
      try {
        const [{ parsePatchFiles }, reactMod] = await Promise.all([
          import("@pierre/diffs"),
          import("@pierre/diffs/react"),
        ]);
        if (cancelToken.cancelled) return;
        const files = parsePatchFiles(diff, "config-agent-review", true).flatMap((patch) => patch.files);
        if (files.length === 0) return;
        setRenderer({ FileDiff: reactMod.FileDiff, files });
      } catch (error) {
        if (cancelToken.cancelled) return;
        // Renderer failed to load/parse — fall back to raw diff text, but report it.
        captureError("config-agent-diff-viewer-render", error);
      }
    });
    return () => {
      cancelToken.cancelled = true;
    };
  }, [diff]);

  if (renderer != null) {
    const { FileDiff } = renderer;
    return (
      <div className="max-h-[60vh] space-y-3 overflow-auto rounded-xl border border-border/30 bg-background/60 p-2">
        {renderer.files.map((fileDiff, index) => (
          <FileDiff
            key={fileDiff.cacheKey ?? `${fileDiff.name}-${index}`}
            fileDiff={fileDiff}
            options={{
              theme: { dark: "github-dark", light: "github-light" },
              diffStyle: "unified",
              hunkSeparators: "line-info-basic",
              overflow: "scroll",
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <pre className="max-h-96 overflow-auto rounded-xl border border-border/30 bg-muted/20 p-4 font-mono text-[11px] text-foreground leading-relaxed whitespace-pre">
      {diff}
    </pre>
  );
}
