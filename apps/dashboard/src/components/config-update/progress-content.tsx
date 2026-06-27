'use client';

import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { ArrowsClockwise } from "@phosphor-icons/react";
import React, { useEffect, useState } from "react";
import type { FileDiffProps } from "@pierre/diffs/react";
import type { FileDiffMetadata } from "@pierre/diffs";

import { useThemeWatcher } from "@/lib/theme";
import { currentEpochMsFromPerformance, type AgentStage } from "./shared";

type StepDef = { key: AgentStage, label: string };

const STAGE_STEPS: StepDef[] = [
  { key: "initializing_sandbox", label: "Initializing agent" },
  { key: "cloning_repo", label: "Cloning repo" },
  { key: "agent_making_changes", label: "Generating changes" },
  { key: "awaiting_review", label: "Ready to review" },
];

function stageIndex(stage: AgentStage | null | undefined): number {
  if (stage == null) return -1;
  return STAGE_STEPS.findIndex((s) => s.key === stage);
}

/**
 * Live "seconds since the run started" counter. The run's `startedAt` is a
 * wall-clock epoch value, with `0` as the "not started yet" sentinel — until a
 * real start time arrives the counter stays at 0 (otherwise it would briefly
 * read ~epoch-since-1970). For a real `startedAt` we capture the start→now offset
 * against a fresh monotonic anchor and advance on that monotonic clock. Both are
 * recomputed whenever `startedAt` changes (e.g. when a flow renders the box
 * before its real start timestamp is known), so the counter resets instead of
 * freezing a stale offset. Recomputing the offset every render — which the old
 * code did — re-added the elapsed time on top of the monotonic delta and made
 * the timer tick at ~2× speed.
 */
function elapsedOffsetMs(startedAt: number): number {
  return startedAt > 0 ? Math.max(0, currentEpochMsFromPerformance() - startedAt) : 0;
}

function useElapsedSeconds(startedAt: number): number {
  const [elapsedMs, setElapsedMs] = useState(() => elapsedOffsetMs(startedAt));
  useEffect(() => {
    const offsetMs = elapsedOffsetMs(startedAt);
    setElapsedMs(offsetMs);
    if (startedAt <= 0) return;
    const anchorPerfMs = performance.now();
    const t = setInterval(() => setElapsedMs(offsetMs + (performance.now() - anchorPerfMs)), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return Math.max(0, Math.floor(elapsedMs / 1000));
}

/**
 * Generic centered "spinner + title + elapsed" box. Shared by every config-apply
 * flow that has a non-interactive "working…" state (the GitHub agent preview and
 * the CLI/RDE local apply), so they look and tick identically.
 */
export function ConfigApplyProgressBox({
  title,
  detail,
  activity,
  startedAt,
}: {
  title: string,
  /** Optional sub-line shown before the elapsed counter, e.g. "2/4: Cloning repo". */
  detail?: string | null,
  /** Optional live activity log; only the last non-empty line is shown. */
  activity?: string | null,
  /** Unix ms timestamp of when the run started. */
  startedAt: number,
}) {
  const elapsed = useElapsedSeconds(startedAt);
  const lastActivityLine = activity?.split("\n").filter((l) => l.trim()).at(-1);

  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 px-6 text-center">
      <ArrowsClockwise className="h-7 w-7 text-muted-foreground animate-spin [animation-duration:1.6s]" />
      <div className="text-base font-medium text-foreground">{title}</div>
      <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
        {detail != null && detail.length > 0 ? `${detail} — ` : ""}{elapsed}s
      </div>
      {lastActivityLine != null && lastActivityLine.trim().length > 0 && (
        <div className="mt-1 max-w-full truncate font-mono text-[11px] text-muted-foreground/80">
          <span className="text-primary mr-1.5">▸</span>
          {lastActivityLine}
        </div>
      )}
    </div>
  );
}

/**
 * Loader rendered inside the GitHub "Commit preview" box while the agent runs.
 * Once the run reaches `awaiting_review` the box swaps this out for the diff, so
 * the surrounding layout stays identical between the running and review states.
 */
export function ConfigAgentPreviewProgress({
  stage,
  startedAt,
  activity,
}: {
  stage: AgentStage | null | undefined,
  /** Unix ms timestamp of when the run started (from the run's started_at). */
  startedAt: number,
  activity?: string | null,
}) {
  const idx = stageIndex(stage);
  const stepNumber = idx < 0 ? 1 : idx + 1;
  const stepLabel = (idx < 0 ? STAGE_STEPS[0] : STAGE_STEPS[idx]).label;

  return (
    <ConfigApplyProgressBox
      title="Generating preview…"
      detail={`${stepNumber}/${STAGE_STEPS.length}: ${stepLabel}`}
      activity={activity}
      startedAt={startedAt}
    />
  );
}

/**
 * Lazy-loaded diff viewer. We parse the sandbox's full `git diff` into file
 * diffs, then render each file with Pierre's React renderer. `PatchDiff` only
 * accepts a single-file patch, while the config agent may legitimately edit
 * helpers/imported config files too.
 */
export function AgentDiffViewer({ diff }: { diff: string }) {
  // Pierre renders into a shadow-DOM `diffs-container`; it picks light vs dark
  // tokens from the host's `color-scheme`, which it derives from `themeType`.
  // The dashboard toggles theme via a `.dark` class (not OS preference), so we
  // feed it the resolved theme explicitly — otherwise the diff would follow the
  // OS and mismatch the rest of the page. The chrome colors (surface, additions,
  // deletions, gutter) are remapped to the project tokens via the
  // `config-agent-diff` class in globals.css.
  const { theme } = useThemeWatcher();
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
      <div className="config-agent-diff max-h-[55vh] space-y-3 overflow-auto p-2">
        {renderer.files.map((fileDiff, index) => (
          <FileDiff
            key={fileDiff.cacheKey ?? `${fileDiff.name}-${index}`}
            fileDiff={fileDiff}
            options={{
              theme: { dark: "github-dark", light: "github-light" },
              themeType: theme,
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
    <pre className="max-h-[55vh] overflow-auto bg-muted/20 p-4 font-mono text-[11px] text-foreground leading-relaxed whitespace-pre">
      {diff}
    </pre>
  );
}
