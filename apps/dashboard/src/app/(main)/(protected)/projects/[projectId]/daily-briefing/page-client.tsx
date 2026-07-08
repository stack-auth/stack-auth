"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { VariationSwitcher } from "./variation-switcher";

// The Daily Briefing prototype ships five complete design takes on the same
// mock briefing. Each variation owns its entire page; this client only hosts
// the active one plus the floating switcher (click or press 1-5).
//
// Variations are client-only (heavy motion, timers) — no SSR keeps wild
// per-variation code free of hydration constraints.

const VARIATIONS = [
  dynamic(() => import("./variations/variation-1"), { ssr: false }),
  dynamic(() => import("./variations/variation-2"), { ssr: false }),
  dynamic(() => import("./variations/variation-3"), { ssr: false }),
  dynamic(() => import("./variations/variation-4"), { ssr: false }),
  dynamic(() => import("./variations/variation-5"), { ssr: false }),
];

const VARIATION_STORAGE_KEY = "daily-briefing-variation";

export default function PageClient() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const stored = Number.parseInt(localStorage.getItem(VARIATION_STORAGE_KEY) ?? "", 10);
    if (stored >= 0 && stored < VARIATIONS.length) {
      setActive(stored);
    }
  }, []);

  const handleChange = (index: number) => {
    setActive(index);
    localStorage.setItem(VARIATION_STORAGE_KEY, String(index));
  };

  const ActiveVariation = VARIATIONS[active];

  return (
    <div className="relative min-h-full">
      <ActiveVariation />
      <VariationSwitcher active={active} onChange={handleChange} />
    </div>
  );
}
