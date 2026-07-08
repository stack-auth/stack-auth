"use client";

import { useCallback, useEffect, useState } from "react";
import { SECTION_ORDER, type BriefingDepth, type BriefingRole, type BriefingSectionId } from "./briefing-config";

const INTRO_SEEN_KEY = "daily-briefing-intro-seen";

export type BriefingState = {
  role: BriefingRole,
  setRole: (role: BriefingRole) => void,
  depth: BriefingDepth,
  setDepth: (depth: BriefingDepth) => void,
  // Section order + visibility, driven by the customize drawer.
  sectionOrder: BriefingSectionId[],
  setSectionOrder: (order: BriefingSectionId[]) => void,
  enabledSections: Set<BriefingSectionId>,
  toggleSection: (id: BriefingSectionId) => void,
  // Cinematic intro. `introPlaying` is false during SSR and becomes true after
  // mount if this session hasn't seen the intro yet (hydration-safe).
  introPlaying: boolean,
  startIntro: () => void,
  finishIntro: () => void,
};

export function useBriefingState(): BriefingState {
  const [role, setRole] = useState<BriefingRole>("admin");
  const [depth, setDepth] = useState<BriefingDepth>("operator");
  const [sectionOrder, setSectionOrder] = useState<BriefingSectionId[]>(SECTION_ORDER);
  const [enabledSections, setEnabledSections] = useState<Set<BriefingSectionId>>(new Set(SECTION_ORDER));
  const [introPlaying, setIntroPlaying] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(INTRO_SEEN_KEY) == null) {
      setIntroPlaying(true);
    }
  }, []);

  const toggleSection = useCallback((id: BriefingSectionId) => {
    setEnabledSections((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const startIntro = useCallback(() => {
    sessionStorage.removeItem(INTRO_SEEN_KEY);
    setIntroPlaying(true);
  }, []);

  const finishIntro = useCallback(() => {
    sessionStorage.setItem(INTRO_SEEN_KEY, "1");
    setIntroPlaying(false);
  }, []);

  return {
    role,
    setRole,
    depth,
    setDepth,
    sectionOrder,
    setSectionOrder,
    enabledSections,
    toggleSection,
    introPlaying,
    startIntro,
    finishIntro,
  };
}
