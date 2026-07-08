"use client";

// Interim preview — the "Bento" design agent replaces this file with its
// full-page take. Until then, show the real masthead + stat strip so the tab
// has content instead of a bare number.

import { HeroStrip } from "../sections/hero-strip";

export default function Variation2() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10">
      <HeroStrip />
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-black/[0.12] px-5 py-4 dark:border-white/[0.14]">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <p className="text-sm text-muted-foreground">
          The <span className="font-medium text-foreground">Bento</span> design is being generated right now — this tab will
          hot-reload into it. Press <span className="font-mono">3</span> for the finished Terminal take.
        </p>
      </div>
    </div>
  );
}
