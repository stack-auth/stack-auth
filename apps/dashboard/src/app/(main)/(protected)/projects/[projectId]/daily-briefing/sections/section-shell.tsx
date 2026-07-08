"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { SECTION_META, type BriefingSectionId } from "../briefing-config";

// Editorial section frame, Dia-brief style: a hairline rule, then a two-column
// grid — mono chapter number + big serif heading on the left, content on the
// right. Sections the current role cannot see are filtered out entirely in
// page-client (never rendered), so this shell has no lock state.

const revealEase = [0.32, 0.72, 0, 1] as const;

export function SectionShell({
  sectionId,
  index,
  children,
}: {
  sectionId: BriefingSectionId,
  index: number,
  children: ReactNode,
}) {
  const meta = SECTION_META[sectionId];
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.section
      id={`briefing-${sectionId}`}
      initial={shouldReduceMotion ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: revealEase }}
      className="scroll-mt-28 border-t border-black/[0.07] pt-10 dark:border-white/[0.08]"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(200px,260px)_1fr] lg:gap-12">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <span className="font-mono text-xs tabular-nums tracking-[0.2em] text-foreground/35">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h2 className="mt-2 text-3xl leading-[1.05] tracking-tight text-foreground sm:text-4xl [font-family:var(--font-briefing-serif),Georgia,serif]">
            {meta.title}
          </h2>
          <p className="mt-3 max-w-[26ch] text-sm leading-relaxed text-muted-foreground">
            {meta.blurb}
          </p>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </motion.section>
  );
}
