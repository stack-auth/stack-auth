"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getContinuumState, subscribeContinuum } from "./continuum-store";
import { formatIncidentTime, getIncidentStage, getStageIndex, INCIDENT_STORY } from "./fixtures/incident";
import type { ContinuumIncidentStage } from "./fixtures/types";

const PLAYBACK_RATE = 12;

export type IncidentPlayback = {
  story: typeof INCIDENT_STORY,
  elapsedMs: number,
  isPlaying: boolean,
  activeStage: ContinuumIncidentStage,
  activeStageIndex: number,
  waitingOnGate: boolean,
  clearedGates: Set<string>,
  formatTime: (ms: number) => string,
  setElapsedMs: (ms: number) => void,
  setIsPlaying: (playing: boolean) => void,
  clearGate: (stageId: string) => void,
  restart: () => void,
};

export function useIncidentPlayback(): IncidentPlayback {
  const [elapsedMs, setElapsedMsState] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [clearedGates, setClearedGates] = useState<Set<string>>(() => new Set());
  const elapsedMsRef = useRef(0);
  const playbackAnchorRef = useRef<{ elapsedMs: number, startedAt: number } | null>(null);

  const activeStage = getIncidentStage(INCIDENT_STORY, elapsedMs);
  const activeStageIndex = getStageIndex(INCIDENT_STORY, elapsedMs);
  const waitingOnGate = activeStage.gate != null && !clearedGates.has(activeStage.id);

  const setElapsedMs = useCallback((next: number) => {
    const clamped = Math.min(Math.max(next, 0), INCIDENT_STORY.durationMs);
    elapsedMsRef.current = clamped;
    setElapsedMsState(clamped);
    if (isPlaying && !waitingOnGate) {
      playbackAnchorRef.current = {
        elapsedMs: clamped,
        startedAt: performance.now(),
      };
    }
  }, [isPlaying, waitingOnGate]);

  const setIsPlayingSafe = useCallback((playing: boolean) => {
    if (playing && waitingOnGate) return;
    setIsPlaying(playing);
    if (playing) {
      playbackAnchorRef.current = {
        elapsedMs: elapsedMsRef.current,
        startedAt: performance.now(),
      };
    } else {
      playbackAnchorRef.current = null;
    }
  }, [waitingOnGate]);

  const clearGate = useCallback((stageId: string) => {
    setClearedGates((prev) => {
      const next = new Set(prev);
      next.add(stageId);
      return next;
    });
    setIsPlaying(true);
    playbackAnchorRef.current = {
      elapsedMs: elapsedMsRef.current,
      startedAt: performance.now(),
    };
  }, []);

  const restart = useCallback(() => {
    setClearedGates(new Set());
    setElapsedMs(0);
    setIsPlaying(false);
    playbackAnchorRef.current = null;
  }, [setElapsedMs]);

  useEffect(() => {
    if (!isPlaying || waitingOnGate) return;

    let frame = 0;
    const tick = () => {
      const anchor = playbackAnchorRef.current;
      if (anchor == null) return;
      const nextElapsed = anchor.elapsedMs + (performance.now() - anchor.startedAt) * PLAYBACK_RATE;
      const stage = getIncidentStage(INCIDENT_STORY, nextElapsed);
      if (stage.gate != null && !clearedGates.has(stage.id) && stage.offsetMs <= nextElapsed) {
        elapsedMsRef.current = stage.offsetMs;
        setElapsedMsState(stage.offsetMs);
        setIsPlaying(false);
        playbackAnchorRef.current = null;
        return;
      }
      if (nextElapsed >= INCIDENT_STORY.durationMs) {
        elapsedMsRef.current = INCIDENT_STORY.durationMs;
        setElapsedMsState(INCIDENT_STORY.durationMs);
        setIsPlaying(false);
        playbackAnchorRef.current = null;
        return;
      }
      elapsedMsRef.current = nextElapsed;
      setElapsedMsState(nextElapsed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, waitingOnGate, clearedGates]);

  return {
    story: INCIDENT_STORY,
    elapsedMs,
    isPlaying,
    activeStage,
    activeStageIndex,
    waitingOnGate,
    clearedGates,
    formatTime: formatIncidentTime,
    setElapsedMs,
    setIsPlaying: setIsPlayingSafe,
    clearGate,
    restart,
  };
}

export function useContinuumStore() {
  return useSyncExternalStore(subscribeContinuum, getContinuumState, getContinuumState);
}
