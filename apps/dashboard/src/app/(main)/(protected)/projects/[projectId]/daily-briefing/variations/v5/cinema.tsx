"use client";

// Variation 5 ("CINEMA") — shared primitives: scene shell, count-up, scroll
// progress plumbing that works inside the dashboard's inner scroll container,
// and the scoped theme tokens (dark = night grade, light = dawn grade).

import { animate, motion, useInView, useMotionValue, useReducedMotion } from "motion/react";
import type { MotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

export const EASE = [0.32, 0.72, 0, 1] as const;
export const SERIF = "[font-family:var(--font-briefing-serif),Georgia,serif]";

// ─── Scroll plumbing ──────────────────────────────────────────────────────────
// The dashboard scrolls an inner overflow-y-auto div, not the window, so
// motion's window-based useScroll never fires. Scroll events don't bubble but
// they DO capture — one capture-phase listener on window sees every container.

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Progress of the whole film: 0 at top of the root element, 1 at its bottom.
export function useFilmProgress(rootRef: React.RefObject<HTMLElement | null>): MotionValue<number> {
  const progress = useMotionValue(0);
  useEffect(() => {
    const update = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = rect.height - vh;
      progress.set(total > 0 ? clamp01(-rect.top / total) : 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true, capture: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
    };
  }, [rootRef, progress]);
  return progress;
}

// Per-scene progress: 0 when the scene's top enters the bottom of the viewport,
// 1 when its bottom leaves the top. Drives parallax without motion's useScroll.
export function useSceneProgress(): { ref: React.RefCallback<HTMLElement>, progress: MotionValue<number> } {
  const progress = useMotionValue(0);
  const nodeRef = useRef<HTMLElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      nodeRef.current = node;
      if (!node) return;
      const update = () => {
        const el = nodeRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight;
        progress.set(clamp01((vh - rect.top) / (rect.height + vh)));
      };
      update();
      window.addEventListener("scroll", update, { passive: true, capture: true });
      window.addEventListener("resize", update);
      cleanupRef.current = () => {
        window.removeEventListener("scroll", update, { capture: true });
        window.removeEventListener("resize", update);
      };
    },
    [progress],
  );

  return { ref, progress };
}

// ─── Count-up ────────────────────────────────────────────────────────────────

export function CountUp(props: {
  to: number,
  format: (v: number) => string,
  className?: string,
  duration?: number,
  delay?: number,
}) {
  const { to, format, className, duration = 1.8, delay = 0 } = props;
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduced = useReducedMotion();
  const [text, setText] = useState(() => format(0));

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setText(format(to));
      return;
    }
    const controls = animate(0, to, {
      duration,
      delay,
      ease: EASE,
      onUpdate: (v) => setText(format(v)),
    });
    return () => controls.stop();
    // format is stable per call site; re-running on identity change would restart the count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced, to, duration, delay]);

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}

// ─── Scene shell ─────────────────────────────────────────────────────────────

export function Scene(props: {
  id: string,
  children: React.ReactNode,
  className?: string,
  sceneRef?: React.RefCallback<HTMLElement>,
}) {
  return (
    <section
      id={props.id}
      ref={props.sceneRef}
      className={`relative flex min-h-[92vh] w-full flex-col items-center justify-center overflow-hidden px-6 py-24 sm:px-12 ${props.className ?? ""}`}
    >
      {props.children}
    </section>
  );
}

// Slate line above each scene: "SCENE 03 — THE ANOMALY".
export function SceneSlate(props: { index: number, title: string, className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.7 }}
      transition={{ duration: 0.7, ease: EASE }}
      className={`mb-8 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.35em] text-[hsl(var(--v5-dim))] ${props.className ?? ""}`}
    >
      <span className="inline-block h-px w-10 bg-current opacity-50" />
      <span>Scene {String(props.index).padStart(2, "0")}</span>
      <span className="opacity-50">—</span>
      <span className="text-[hsl(var(--v5-ink))]">{props.title}</span>
      <span className="inline-block h-px w-10 bg-current opacity-50" />
    </motion.div>
  );
}

// Reveal-on-scroll wrapper with the house ease.
export function Rise(props: {
  children: React.ReactNode,
  delay?: number,
  y?: number,
  className?: string,
  amount?: number,
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: props.y ?? 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: props.amount ?? 0.35 }}
      transition={{ duration: 0.85, delay: props.delay ?? 0, ease: EASE }}
      className={props.className}
    >
      {props.children}
    </motion.div>
  );
}

// Delta chip: "+12.4% vs yesterday".
export function DeltaChip(props: { deltaPct: number, suffix?: string, className?: string }) {
  const { deltaPct } = props;
  const flat = deltaPct === 0;
  const up = deltaPct > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-xs font-semibold tabular-nums ${
        flat
          ? "border-[hsl(var(--v5-dim)/0.3)] text-[hsl(var(--v5-dim))]"
          : up
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
      } ${props.className ?? ""}`}
    >
      {flat ? "→" : up ? "▲" : "▼"} {flat ? "steady" : `${up ? "+" : ""}${deltaPct.toFixed(1)}%`}
      {props.suffix ? <span className="font-normal opacity-70">{props.suffix}</span> : null}
    </span>
  );
}

// Frosted glass card, tuned per theme.
export function GlassCard(props: { children: React.ReactNode, className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-[hsl(var(--v5-line))] bg-[hsl(var(--v5-glass))] shadow-[0_8px_40px_hsl(var(--v5-shadow))] backdrop-blur-xl ${props.className ?? ""}`}
    >
      {props.children}
    </div>
  );
}

// ─── Scoped theme + keyframes ────────────────────────────────────────────────
// All v5 colors flow through these variables so both grades stay coherent.
// Dark = deep navy-black night grade with aurora glows; light = dawn grade.

export function CinemaStyles() {
  return (
    <style>{`
      .v5-root {
        --v5-bg: 36 80% 97%;
        --v5-ink: 232 40% 12%;
        --v5-dim: 232 16% 42%;
        --v5-line: 232 30% 12% / 0.12;
        --v5-glass: 40 80% 99% / 0.72;
        --v5-shadow: 25 60% 40% / 0.10;
        --v5-glow-a: 18 95% 62%;
        --v5-glow-b: 262 80% 66%;
        --v5-glow-c: 199 90% 55%;
        --v5-accent: 262 70% 48%;
        --v5-scene-dark-bg: 232 44% 8%;
        --v5-scene-dark-ink: 224 40% 94%;
      }
      .dark .v5-root {
        --v5-bg: 230 45% 4%;
        --v5-ink: 222 40% 95%;
        --v5-dim: 226 18% 62%;
        --v5-line: 220 60% 90% / 0.12;
        --v5-glass: 228 40% 12% / 0.62;
        --v5-shadow: 230 60% 2% / 0.6;
        --v5-glow-a: 168 84% 45%;
        --v5-glow-b: 262 85% 62%;
        --v5-glow-c: 199 95% 58%;
        --v5-accent: 199 95% 62%;
        --v5-scene-dark-bg: 230 48% 3%;
        --v5-scene-dark-ink: 222 40% 95%;
      }
      @keyframes v5-drift-a {
        0% { transform: translate3d(-6%, -4%, 0) scale(1); }
        50% { transform: translate3d(7%, 6%, 0) scale(1.18); }
        100% { transform: translate3d(-6%, -4%, 0) scale(1); }
      }
      @keyframes v5-drift-b {
        0% { transform: translate3d(8%, 5%, 0) scale(1.1); }
        50% { transform: translate3d(-7%, -7%, 0) scale(0.94); }
        100% { transform: translate3d(8%, 5%, 0) scale(1.1); }
      }
      @keyframes v5-drift-c {
        0% { transform: translate3d(0%, 8%, 0) scale(0.95); }
        50% { transform: translate3d(-4%, -6%, 0) scale(1.15); }
        100% { transform: translate3d(0%, 8%, 0) scale(0.95); }
      }
      @keyframes v5-radar {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes v5-ping {
        0% { transform: scale(0.6); opacity: 0.9; }
        80% { transform: scale(2.6); opacity: 0; }
        100% { transform: scale(2.6); opacity: 0; }
      }
      @keyframes v5-pulse-soft {
        0%, 100% { opacity: 0.55; }
        50% { opacity: 1; }
      }
      @keyframes v5-credits {
        from { transform: translateY(0); }
        to { transform: translateY(-50%); }
      }
      @media (prefers-reduced-motion: reduce) {
        .v5-root .v5-anim { animation: none !important; }
      }
    `}</style>
  );
}

// Aurora backdrop: three blurred radial glows drifting on CSS keyframes.
// Transform-only animation on GPU-friendly layers.
export function Aurora(props: { className?: string, dimmed?: boolean }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${props.className ?? ""}`}>
      <div
        className="v5-anim absolute -left-[15%] -top-[20%] h-[70%] w-[70%] rounded-full blur-3xl"
        style={{
          background: "radial-gradient(circle, hsl(var(--v5-glow-a) / 0.34), transparent 65%)",
          animation: "v5-drift-a 26s ease-in-out infinite",
          opacity: props.dimmed ? 0.5 : 1,
        }}
      />
      <div
        className="v5-anim absolute -right-[12%] top-[8%] h-[65%] w-[60%] rounded-full blur-3xl"
        style={{
          background: "radial-gradient(circle, hsl(var(--v5-glow-b) / 0.30), transparent 65%)",
          animation: "v5-drift-b 32s ease-in-out infinite",
          opacity: props.dimmed ? 0.5 : 1,
        }}
      />
      <div
        className="v5-anim absolute bottom-[-25%] left-[20%] h-[70%] w-[65%] rounded-full blur-3xl"
        style={{
          background: "radial-gradient(circle, hsl(var(--v5-glow-c) / 0.26), transparent 65%)",
          animation: "v5-drift-c 38s ease-in-out infinite",
          opacity: props.dimmed ? 0.5 : 1,
        }}
      />
    </div>
  );
}
