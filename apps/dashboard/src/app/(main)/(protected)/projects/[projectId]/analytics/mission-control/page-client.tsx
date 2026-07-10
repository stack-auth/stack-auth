"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignCategoryTabs,
} from "@/components/design-components";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { StickyPageHeader } from "../../sticky-page-header";
import { IncidentEvidence } from "./incident-evidence";
import { IncidentPlayback } from "./incident-playback";
import {
  INCIDENT_STORIES,
  getPlaybackStage,
  type IncidentStory,
} from "./stories";
import { TelemetryInvestigation } from "./telemetry-investigation";
import { useEffect, useMemo, useRef, useState } from "react";

const PLAYBACK_RATE = 24;

function getInitialStory(): IncidentStory {
  return INCIDENT_STORIES[0];
}

function getStory(storyId: string): IncidentStory {
  const story = INCIDENT_STORIES.find((candidate) => candidate.id === storyId);
  if (story == null) {
    throw new Error(`Mission Control story "${storyId}" is not registered.`);
  }
  return story;
}

export default function PageClient() {
  const initialStory = getInitialStory();
  const [storyId, setStoryId] = useState(initialStory.id);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(
    initialStory.waterfallSpans[0]?.id ?? null,
  );
  const [selectedRemediationId, setSelectedRemediationId] = useState<string | null>(null);
  const elapsedMsRef = useRef(0);
  const playbackAnchorRef = useRef<{ elapsedMs: number, startedAt: number } | null>(null);

  const story = useMemo(() => getStory(storyId), [storyId]);
  const storyCategories = useMemo(
    () => INCIDENT_STORIES.map((candidate) => ({
      id: candidate.id,
      label: candidate.shortTitle,
      badgeCount: candidate.affectedUsers,
    })),
    [],
  );
  const activeStage = getPlaybackStage(story, elapsedMs);
  const activeStageIndex = activeStage == null ? 0 : story.stages.indexOf(activeStage);

  useEffect(() => {
    if (!isPlaying) {
      playbackAnchorRef.current = null;
      return;
    }

    playbackAnchorRef.current = {
      elapsedMs: elapsedMsRef.current,
      startedAt: performance.now(),
    };
    let animationFrameId = 0;

    const advancePlayback = (now: number) => {
      const anchor = playbackAnchorRef.current;
      if (anchor == null) return;
      const nextElapsedMs = Math.min(
        story.durationMs,
        anchor.elapsedMs + (now - anchor.startedAt) * PLAYBACK_RATE,
      );
      elapsedMsRef.current = nextElapsedMs;
      setElapsedMs(nextElapsedMs);
      if (nextElapsedMs >= story.durationMs) {
        setIsPlaying(false);
        return;
      }
      animationFrameId = requestAnimationFrame(advancePlayback);
    };

    animationFrameId = requestAnimationFrame(advancePlayback);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, story.durationMs]);

  const selectStory = (nextStoryId: string) => {
    const nextStory = getStory(nextStoryId);
    setStoryId(nextStoryId);
    elapsedMsRef.current = 0;
    setElapsedMs(0);
    setIsPlaying(false);
    setSelectedSpanId(nextStory.waterfallSpans[0]?.id ?? null);
    setSelectedRemediationId(null);
  };

  const setPlaybackElapsed = (nextElapsedMs: number) => {
    const clampedElapsedMs = Math.min(Math.max(nextElapsedMs, 0), story.durationMs);
    elapsedMsRef.current = clampedElapsedMs;
    setElapsedMs(clampedElapsedMs);
    if (isPlaying) {
      playbackAnchorRef.current = {
        elapsedMs: clampedElapsedMs,
        startedAt: performance.now(),
      };
    }
  };

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout fillWidth allowContentOverflow>
        <div className="flex flex-col gap-4">
          <StickyPageHeader
            title="Mission Control"
            description="Playback real user impact from first symptom to verified recovery."
            sticky
            layoutGroupId="mission-control-sticky-header"
            actions={
              <div className="flex items-center gap-2">
                <DesignBadge
                  label={story.severity}
                  color={story.severity === "SEV-1" ? "red" : "orange"}
                  size="sm"
                />
                <DesignBadge label="Synthetic incident" color="cyan" size="sm" />
              </div>
            }
          />

          <DesignCategoryTabs
            categories={storyCategories}
            selectedCategory={story.id}
            onSelect={selectStory}
            showBadge
            gradient="cyan"
            glassmorphic
          />

          <DesignAlert
            variant={
              activeStage?.kind === "impact"
                ? "error"
                : activeStage?.kind === "mitigation"
                  ? "warning"
                  : activeStage?.kind === "recovery"
                    ? "success"
                    : "info"
            }
            title={activeStage?.title ?? story.title}
            description={activeStage?.summary ?? story.summary}
            glassmorphic
          />

          <IncidentPlayback
            story={story}
            elapsedMs={elapsedMs}
            isPlaying={isPlaying}
            onElapsedChange={setPlaybackElapsed}
            onPlayingChange={setIsPlaying}
          />

          <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(24rem,0.65fr)]">
            <TelemetryInvestigation
              story={story}
              activeStageIndex={activeStageIndex}
              selectedSpanId={selectedSpanId}
              onSelectSpan={setSelectedSpanId}
            />
            <IncidentEvidence
              story={story}
              activeStageIndex={activeStageIndex}
              selectedRemediationId={selectedRemediationId}
              onSelectRemediation={setSelectedRemediationId}
            />
          </div>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
