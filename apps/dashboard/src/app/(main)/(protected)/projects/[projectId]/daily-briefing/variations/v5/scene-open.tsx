"use client";

// Scenes 1 & 2 — the cold open and the numbers montage.

import { motion, useReducedMotion, useTransform } from "motion/react";
import { CaretDoubleDownIcon } from "@phosphor-icons/react";
import { fmtDay, fmtNum, fmtUsd, HERO_STATS, MOCK_HEADLINE, MOCK_VIEWER, BRIEFING_NOW_MS } from "../../mock-data";
import type { HeroStat } from "../../mock-data";
import { Aurora, CountUp, DeltaChip, EASE, Rise, Scene, SceneSlate, SERIF, useSceneProgress } from "./cinema";

const REVENUE_STAT = HERO_STATS.find((s) => s.id === "revenue") ?? HERO_STATS[0];

export function SceneColdOpen() {
  const reduced = useReducedMotion();
  const { ref, progress } = useSceneProgress();
  // Gentle camera pull as you scroll past the title card.
  const drift = useTransform(progress, [0.5, 1], [0, -80]);
  const fade = useTransform(progress, [0.55, 0.95], [1, 0]);

  return (
    <Scene id="v5-scene-1" sceneRef={ref} className="min-h-[100vh]">
      <Aurora />
      <motion.div
        style={reduced ? undefined : { y: drift, opacity: fade }}
        className="relative z-10 flex max-w-5xl flex-col items-center text-center"
      >
        <motion.p
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, ease: EASE }}
          className="mb-6 font-mono text-[11px] uppercase tracking-[0.4em] text-[hsl(var(--v5-dim))]"
        >
          {fmtDay(BRIEFING_NOW_MS)} · Daily briefing for {MOCK_VIEWER.firstName}
        </motion.p>

        <motion.h1
          initial={reduced ? false : { opacity: 0, y: 40, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 1.2, delay: 0.15, ease: EASE }}
          className={`${SERIF} text-balance text-5xl leading-[1.05] text-[hsl(var(--v5-ink))] sm:text-7xl lg:text-8xl`}
        >
          While you slept,
          <br />
          <span className="text-[hsl(var(--v5-accent))]">{MOCK_VIEWER.projectName}</span> kept moving.
        </motion.h1>

        <motion.p
          initial={reduced ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 1.0, ease: EASE }}
          className="mt-8 max-w-2xl text-balance text-base text-[hsl(var(--v5-dim))] sm:text-lg"
        >
          {MOCK_HEADLINE}
        </motion.p>

        <motion.div
          initial={reduced ? false : { opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, delay: 1.7, ease: EASE }}
          className="mt-14 flex flex-col items-center"
        >
          <span className="font-mono text-[11px] uppercase tracking-[0.35em] text-[hsl(var(--v5-dim))]">
            Revenue yesterday
          </span>
          <CountUp
            to={REVENUE_STAT.value}
            format={(v) => fmtUsd(Math.round(v / 100) * 100)}
            duration={2.4}
            delay={reduced ? 0 : 1.9}
            className="mt-2 font-mono text-6xl font-bold tabular-nums tracking-tight text-[hsl(var(--v5-ink))] sm:text-8xl lg:text-9xl"
          />
          <div className="mt-4">
            <DeltaChip deltaPct={REVENUE_STAT.deltaPct} suffix=" vs yesterday" />
          </div>
        </motion.div>
      </motion.div>

      <motion.div
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 3, ease: EASE }}
        className="absolute bottom-24 left-1/2 z-10 -translate-x-1/2 text-[hsl(var(--v5-dim))]"
      >
        <motion.div
          animate={reduced ? undefined : { y: [0, 8, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          className="flex flex-col items-center gap-2"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.35em]">Roll film</span>
          <CaretDoubleDownIcon size={18} weight="bold" />
        </motion.div>
      </motion.div>
    </Scene>
  );
}

// Scene 2 — hero stats choreographed one at a time; each row carries its own hue.
const STAT_HUES = ["var(--v5-glow-a)", "var(--v5-glow-b)", "var(--v5-glow-c)", "var(--v5-glow-a)", "var(--v5-glow-b)"];

function formatStatValue(stat: HeroStat, v: number): string {
  if (stat.format === "usd") return fmtUsd(Math.round(v / 100) * 100);
  if (stat.format === "percent") return `${(Math.round(v * 100) / 100).toFixed(2)}%`;
  return fmtNum(Math.round(v));
}

export function SceneNumbers() {
  return (
    <Scene id="v5-scene-2">
      <Aurora dimmed />
      <div className="relative z-10 w-full max-w-4xl">
        <SceneSlate index={2} title="The numbers" className="justify-center" />
        <Rise className="mb-14 text-center">
          <h2 className={`${SERIF} text-4xl text-[hsl(var(--v5-ink))] sm:text-5xl`}>Overnight, in five figures.</h2>
        </Rise>

        <div className="flex flex-col">
          {HERO_STATS.map((stat, i) => (
            <Rise key={stat.id} delay={0.05} amount={0.5}>
              <div className="group relative flex flex-col items-baseline gap-2 border-b border-[hsl(var(--v5-line))] py-7 sm:flex-row sm:items-center sm:gap-6">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-x-8 inset-y-0 opacity-0 blur-2xl transition-opacity duration-700 group-hover:opacity-100"
                  style={{ background: `radial-gradient(ellipse at 30% 50%, hsl(${STAT_HUES[i % STAT_HUES.length]} / 0.14), transparent 70%)` }}
                />
                <span className="w-48 shrink-0 font-mono text-[11px] uppercase tracking-[0.3em] text-[hsl(var(--v5-dim))]">
                  {stat.label}
                </span>
                <CountUp
                  to={stat.value}
                  format={(v) => formatStatValue(stat, v)}
                  duration={1.6}
                  className="font-mono text-5xl font-bold tabular-nums tracking-tight text-[hsl(var(--v5-ink))] sm:text-6xl"
                />
                <div className="sm:ml-auto">
                  <DeltaChip deltaPct={stat.deltaPct} />
                </div>
              </div>
            </Rise>
          ))}
        </div>
      </div>
    </Scene>
  );
}
