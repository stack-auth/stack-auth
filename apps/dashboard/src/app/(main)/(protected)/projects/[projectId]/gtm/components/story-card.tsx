"use client";

import { cn } from "@/lib/utils";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion, type Transition, type Variants } from "motion/react";
import type { ReactNode } from "react";

/**
 * Chrome for the GTM "story card" — a full-bleed gradient canvas with a dark
 * caption bar underneath, modelled 1:1 on the briefing card design (canvas is
 * 100:86 against the card width, caption bar carries an accent eyebrow plus a
 * progress rail on the right).
 *
 * Story slides use an art-directed aspect ratio. Taller content such as the
 * intake form opts into intrinsic sizing so it can extend the dialog's scroll
 * region instead of being clipped behind the caption bar.
 */

export type GtmStoryChapter = {
  /** Stable identity for the slide; also drives the enter/exit animation key. */
  key: string,
  /** Small uppercase label in the caption bar, tinted with `accent`. */
  eyebrow: string,
  /** Bold one-liner in the caption bar summarising the slide. */
  caption: string,
  /** Hex colour used for the eyebrow and in-canvas accents. */
  accent: string,
  /** Full `background` shorthand for the canvas — layered radials read as a mesh. */
  wash: string,
};

/**
 * Springs (rather than eased tweens) so content lands with the slight overshoot
 * the design calls for. `mass`/`damping` are tuned to overshoot by a few pixels
 * only — enough to feel alive, not enough to read as a bounce.
 */
const revealSpring: Transition = { type: "spring", stiffness: 420, damping: 26, mass: 0.9 };

export const storyCanvasVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
  exit: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
};

export const storyRevealVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: revealSpring },
  // Exits are deliberately short and shallow: the wash underneath crossfades on
  // its own, so the slide swap should never leave a visible empty frame.
  exit: { opacity: 0, y: -10, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } },
};

/** One staggered element inside a story slide. Children fade up with a slight overshoot. */
export function StoryReveal({ children, className }: { children: ReactNode, className?: string }) {
  return (
    <motion.div variants={storyRevealVariants} className={className}>
      {children}
    </motion.div>
  );
}

function StoryProgress(props: {
  chapters: readonly GtmStoryChapter[],
  activeIndex: number,
  onSelect?: (index: number) => void,
  reducedMotion: boolean,
}) {
  return (
    <div className="flex items-center gap-2" role="tablist" aria-label="Story progress">
      {props.chapters.map((chapter, index) => {
        const isActive = index === props.activeIndex;
        return (
          <motion.button
            key={chapter.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={chapter.caption}
            disabled={props.onSelect == null}
            onClick={() => props.onSelect?.(index)}
            initial={false}
            animate={{ width: isActive ? 28 : 6 }}
            transition={props.reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 460, damping: 34 }}
            className={cn(
              "h-1.5 shrink-0 rounded-full transition-colors hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#19191D]",
              isActive ? "bg-white" : "bg-white/30",
              props.onSelect != null && !isActive && "hover:bg-white/55",
            )}
          />
        );
      })}
    </div>
  );
}

export function GtmStoryCard(props: {
  chapters: readonly GtmStoryChapter[],
  activeIndex: number,
  /** The completion screen keeps the handoff step active in the rail while using its own visual treatment. */
  activeChapter?: GtmStoryChapter,
  /** Intake forms need their intrinsic height; story slides retain the art-directed ratio. */
  fitContent?: boolean,
  /** Omit to render the rail as a non-interactive indicator. */
  onSelect?: (index: number) => void,
  /** Omit when the card must not be dismissible (e.g. the mandatory intake). */
  onClose?: () => void,
  children: ReactNode,
}) {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const chapter = props.activeChapter ?? props.chapters.at(props.activeIndex)
    ?? throwErr(`GtmStoryCard was given activeIndex ${props.activeIndex}, which is outside its ${props.chapters.length} chapters. Callers must keep the index clamped to the chapter list they pass in.`);

  return (
    <div className="relative flex w-full flex-col overflow-hidden rounded-2xl bg-[#19191D] text-white">
      {/* overflow-hidden matters for popLayout exits: a slide that is lifted out of
          flow keeps its old height and would otherwise paint over the caption bar. */}
      <div className={cn(
        "relative w-full overflow-hidden",
        props.fitContent ? "min-h-fit" : "aspect-[100/86]",
      )}>
        {/* The wash lives outside the content AnimatePresence and crossfades on its
            own, so the card never flashes empty while slides swap. */}
        <AnimatePresence initial={false}>
          <motion.div
            key={chapter.key}
            aria-hidden
            className="absolute inset-0"
            style={{ background: chapter.wash }}
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
          />
        </AnimatePresence>
        <div className="relative flex min-h-full flex-col p-7">
          {props.children}
        </div>
        {props.onClose != null && (
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close"
            className="absolute right-3.5 top-3.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/25 text-white/90 backdrop-blur-sm transition-colors duration-150 hover:bg-black/40 hover:text-white hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <XIcon className="h-3.5 w-3.5" weight="bold" />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 bg-[#19191D] px-5 py-3.5">
        <div className="min-w-0 overflow-hidden">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={chapter.key}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, y: -10 }}
              transition={prefersReducedMotion ? { duration: 0 } : revealSpring}
            >
              <p
                className="text-[11px] font-semibold uppercase leading-none tracking-[0.16em]"
                style={{ color: chapter.accent }}
              >
                {chapter.eyebrow}
              </p>
              <p className="mt-1.5 truncate text-[17px] font-semibold leading-tight text-white">
                {chapter.caption}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
        {/* A one-chapter rail would read as a stray dash, so it only appears once
            there is actually something to page through. */}
        {props.chapters.length > 1 && (
          <StoryProgress
            chapters={props.chapters}
            activeIndex={props.activeIndex}
            onSelect={props.onSelect}
            reducedMotion={prefersReducedMotion}
          />
        )}
      </div>
    </div>
  );
}
