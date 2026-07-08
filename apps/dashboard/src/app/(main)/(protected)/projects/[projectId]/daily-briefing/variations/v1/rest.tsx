"use client";

import { cn } from "@/components/ui";
import {
  CaretDownIcon,
  CheckIcon,
  CursorClickIcon,
  FireSimpleIcon,
  PaperPlaneTiltIcon,
  PlayIcon,
  ShieldCheckIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { fmtUsd } from "../../mock-data";
import {
  BENCHMARKS,
  DELIVERY_CHANNELS,
  DRAFTED_EMAILS,
  INCIDENT,
  ONE_THING,
  REPLAY_CARDS,
  SALES_PLAYS,
  SECURITY_REPORT,
  TEAM_PULSE,
  type DraftedEmail,
} from "./fixtures";
import { Caption, EDITORIAL_EASE, GhostAction, Hairline, Monogram, RuledButton, SERIF } from "./primitives";

// The remaining editorial chapters: 04 replays, 05 security, 06 sales,
// 07 drafted emails, 08 incident, 09 team pulse, 10 benchmarks, 11 one thing,
// 12 delivery colophon.

// ─── 04 · Replays worth watching ──────────────────────────────────────────────

export function ReplaysChapter() {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="grid gap-6 sm:grid-cols-3">
      {REPLAY_CARDS.map((replay) => (
        <div key={replay.id} className="group flex flex-col">
          <div className={cn("relative aspect-[4/3] overflow-hidden border border-black/[0.08] dark:border-white/[0.1]", replay.screenClass)}>
            {/* Fake app chrome on the "screen" */}
            <div className="absolute inset-x-3 top-3 h-2 rounded-full bg-white/45 dark:bg-white/15" />
            <div className="absolute inset-x-3 top-7 bottom-8 rounded-sm bg-white/25 dark:bg-white/[0.07]" />
            {/* Wandering cursor */}
            {!shouldReduceMotion && (
              <motion.span
                className="absolute h-2 w-2 rounded-full bg-foreground/70 shadow-[0_0_0_4px_rgba(255,255,255,0.35)] dark:shadow-[0_0_0_4px_rgba(0,0,0,0.35)]"
                animate={{
                  x: replay.rage ? [18, 22, 16, 24, 18, 60, 18] : [20, 90, 60, 120, 40],
                  y: replay.rage ? [40, 42, 38, 44, 40, 46, 40] : [30, 44, 70, 52, 36],
                }}
                transition={{ duration: replay.rage ? 1.6 : 7, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            {replay.rage && (
              <span className="absolute left-3 bottom-8 inline-flex items-center gap-1 bg-red-600/90 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-white">
                <CursorClickIcon className="h-3 w-3" weight="bold" />
                rage clicks
              </span>
            )}
            {/* Scrub bar */}
            <div className="absolute inset-x-3 bottom-3 h-1 bg-white/40 dark:bg-white/15">
              <div className="h-full bg-foreground/70" style={{ width: `${replay.progressPct}%` }} />
            </div>
            {/* Play affordance */}
            <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background">
                <PlayIcon className="h-4 w-4" weight="fill" />
              </span>
            </span>
          </div>
          <span className="mt-3 text-[15px] font-medium leading-snug text-foreground">{replay.title}</span>
          <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/40">
            {replay.subtitle} · {replay.duration}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── 05 · Security report ─────────────────────────────────────────────────────

export function SecurityChapter() {
  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-3 py-4">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 text-emerald-700 dark:text-emerald-400" weight="fill" />
        <p className="max-w-[62ch] text-sm leading-relaxed text-foreground/85">{SECURITY_REPORT.secretScan}</p>
      </div>
      <Hairline />
      {SECURITY_REPORT.unusualLogins.map((login) => (
        <div key={login.id}>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 py-4 sm:grid-cols-[64px_auto_1fr]">
            <span className="hidden font-mono text-xs tabular-nums text-foreground/40 sm:block">{login.atLabel}</span>
            <WarningIcon className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400" weight="regular" />
            <div>
              <span className="text-[15px] font-medium text-foreground">{login.who}</span>
              <p className="mt-0.5 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">{login.what}</p>
            </div>
          </div>
          <Hairline />
        </div>
      ))}
      <div className="grid gap-x-10 gap-y-4 py-5 sm:grid-cols-2">
        <div>
          <span className={cn("text-3xl leading-none text-foreground", SERIF)}>{SECURITY_REPORT.mfaNudge.count}</span>
          <p className="mt-2 max-w-[36ch] text-sm leading-relaxed text-muted-foreground">
            {SECURITY_REPORT.mfaNudge.detail} — {SECURITY_REPORT.mfaNudge.names}.
          </p>
          <GhostAction className="mt-3">Require MFA for admins</GhostAction>
        </div>
        <div>
          <span className={cn("text-3xl leading-none text-foreground", SERIF)}>{SECURITY_REPORT.cves.count}</span>
          <p className="mt-2 max-w-[36ch] text-sm leading-relaxed text-muted-foreground">{SECURITY_REPORT.cves.detail}.</p>
          <GhostAction className="mt-3">Review patch PRs</GhostAction>
        </div>
      </div>
    </div>
  );
}

// ─── 06 · Today's play ────────────────────────────────────────────────────────

export function SalesChapter() {
  return (
    <div className="flex flex-col">
      <Caption className="pb-2">Three accounts, ranked by closing odds today</Caption>
      {SALES_PLAYS.map((play, i) => (
        <div key={play.id}>
          {i > 0 && <Hairline />}
          <div className="grid grid-cols-[auto_1fr] items-start gap-x-5 py-5 sm:grid-cols-[40px_auto_1fr_auto]">
            <span className={cn("pt-0.5 text-2xl leading-none text-foreground/30", SERIF)}>{play.rank}</span>
            <Monogram letters={play.monogram} className="hidden sm:flex" />
            <div className="min-w-0">
              <span className="text-[15px] font-medium leading-snug text-foreground">{play.company}</span>
              <p className="mt-1 max-w-[56ch] text-sm leading-relaxed text-muted-foreground">{play.whyNow}</p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/50">
                Play: {play.motion}
              </p>
            </div>
            <span className="col-start-2 mt-1 font-mono text-sm tabular-nums text-foreground/70 sm:col-start-4 sm:mt-0.5">
              {fmtUsd(play.expectedValueCents)}<span className="text-foreground/35">/yr</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 07 · Drafted emails ──────────────────────────────────────────────────────

function DraftRow({ draft }: { draft: DraftedEmail }) {
  const shouldReduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [planeFlying, setPlaneFlying] = useState(false);

  const send = () => {
    setPlaneFlying(true);
    setTimeout(() => {
      setSent(true);
      setOpen(false);
    }, shouldReduceMotion ? 0 : 650);
  };

  return (
    <div className={cn("transition-opacity", sent && "opacity-70")}>
      <button
        type="button"
        onClick={() => !sent && setOpen((v) => !v)}
        className="grid w-full grid-cols-[auto_1fr_auto] items-baseline gap-x-4 py-4 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">{draft.kind}</span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium leading-snug text-foreground">{draft.subject}</span>
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            To {draft.toName} — {draft.preview}
          </span>
        </span>
        {sent ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
            <CheckIcon className="h-3.5 w-3.5" weight="bold" />
            Sent — just now
          </span>
        ) : (
          <CaretDownIcon
            className={cn("h-3.5 w-3.5 text-foreground/40 transition-transform duration-200", open && "rotate-180")}
            weight="bold"
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && !sent && (
          <motion.div
            initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: EDITORIAL_EASE }}
            className="overflow-hidden"
          >
            {/* Mail frame */}
            <div className="relative mb-5 border border-black/[0.1] bg-white/70 dark:border-white/[0.12] dark:bg-white/[0.03]">
              <div className="flex items-center gap-1.5 border-b border-black/[0.07] px-4 py-2.5 dark:border-white/[0.08]">
                <span className="h-2 w-2 rounded-full bg-foreground/15" />
                <span className="h-2 w-2 rounded-full bg-foreground/15" />
                <span className="h-2 w-2 rounded-full bg-foreground/15" />
                <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/40">
                  New message — drafted 06:12 by your briefing
                </span>
              </div>
              <div className="border-b border-black/[0.05] px-5 py-2 font-mono text-[11px] text-foreground/55 dark:border-white/[0.06]">
                To: {draft.toName} &lt;{draft.to}&gt;
              </div>
              <div className="border-b border-black/[0.05] px-5 py-2 font-mono text-[11px] text-foreground/55 dark:border-white/[0.06]">
                Subject: {draft.subject}
              </div>
              <div className="flex flex-col gap-3 px-5 py-5">
                {draft.body.map((paragraph, i) => (
                  <p key={i} className="max-w-[64ch] text-sm leading-relaxed text-foreground/85">{paragraph}</p>
                ))}
              </div>
              <div className="flex items-center gap-5 border-t border-black/[0.07] px-5 py-3.5 dark:border-white/[0.08]">
                <RuledButton onClick={send} disabled={planeFlying}>
                  <PaperPlaneTiltIcon className="h-3.5 w-3.5" weight="fill" />
                  Send now
                </RuledButton>
                <GhostAction className="text-foreground/40">Edit first</GhostAction>
              </div>
              {/* Paper plane fly-off */}
              <AnimatePresence>
                {planeFlying && !shouldReduceMotion && (
                  <motion.span
                    key="plane"
                    initial={{ opacity: 1, x: 24, y: 0, rotate: 0 }}
                    animate={{ opacity: 0, x: 420, y: -120, rotate: -18 }}
                    transition={{ duration: 0.65, ease: [0.4, 0, 0.9, 0.4] }}
                    className="pointer-events-none absolute bottom-4 left-24 text-foreground"
                  >
                    <PaperPlaneTiltIcon className="h-5 w-5" weight="fill" />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function EmailsChapter() {
  return (
    <div className="flex flex-col">
      <Caption className="pb-2">Three drafts, written overnight against replays, usage, and the deploy queue</Caption>
      {DRAFTED_EMAILS.map((draft, i) => (
        <div key={draft.id}>
          {i > 0 && <Hairline />}
          <DraftRow draft={draft} />
        </div>
      ))}
    </div>
  );
}

// ─── 08 · Incident ────────────────────────────────────────────────────────────

export function IncidentChapter() {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-[15px] font-medium text-foreground">{INCIDENT.title}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/40">
          {INCIDENT.window} · peak {INCIDENT.peak}
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
          <CheckIcon className="h-3 w-3" weight="bold" />
          recovered {INCIDENT.resolvedAt}
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-700 dark:text-amber-400">
          <WarningIcon className="h-3 w-3" weight="bold" />
          root cause still open
        </span>
      </div>

      {/* Span waterfall, editorial: hairline rows, offset ink bars */}
      <div className="flex flex-col gap-2">
        {INCIDENT.spans.map((span, i) => (
          <div key={span.id} className="grid grid-cols-[minmax(120px,180px)_1fr_auto] items-center gap-x-4">
            <span className="truncate font-mono text-[11px] text-foreground/55">{span.label}</span>
            <div className="relative h-3.5">
              <motion.div
                initial={shouldReduceMotion ? false : { scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.07, ease: EDITORIAL_EASE }}
                style={{ left: `${span.startPct}%`, width: `${span.widthPct}%`, transformOrigin: "left" }}
                className={cn(
                  "absolute top-0 h-full",
                  span.hot
                    ? "bg-red-600/75 dark:bg-red-500/70"
                    : "bg-foreground/25 dark:bg-foreground/30",
                )}
              />
            </div>
            <span className={cn("font-mono text-[11px] tabular-nums", span.hot ? "text-red-700 dark:text-red-400" : "text-foreground/45")}>
              {span.durLabel}
            </span>
          </div>
        ))}
      </div>

      <p className="max-w-[64ch] text-sm leading-relaxed text-muted-foreground">{INCIDENT.cause}</p>
      <div>
        <GhostAction>Draft the fix ticket</GhostAction>
      </div>
    </div>
  );
}

// ─── 09 · Team pulse ──────────────────────────────────────────────────────────

export function TeamPulseChapter() {
  return (
    <div className="flex flex-col">
      {TEAM_PULSE.map((entry, i) => (
        <div key={entry.id}>
          {i > 0 && <Hairline />}
          <div className="py-4">
            <p className="max-w-[62ch] text-sm leading-relaxed text-foreground/85">
              <span className="font-medium text-foreground">{entry.who}</span> {entry.what}.
            </p>
            <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/35">
              {entry.whenLabel}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 10 · Benchmarks ──────────────────────────────────────────────────────────

export function BenchmarksChapter() {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="flex flex-col">
      {BENCHMARKS.map((benchmark, i) => (
        <div key={benchmark.id}>
          {i > 0 && <Hairline />}
          <div className="grid items-center gap-x-8 gap-y-2 py-5 sm:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <span className={cn("text-2xl leading-none text-foreground", SERIF)}>
                {benchmark.percentile}
                <span className="text-base text-foreground/40">th percentile</span>
              </span>
              <p className="mt-1.5 max-w-[52ch] text-sm leading-relaxed text-muted-foreground">{benchmark.line}.</p>
            </div>
            <div className="relative h-1.5 bg-foreground/[0.08]">
              <motion.div
                initial={shouldReduceMotion ? false : { width: 0 }}
                whileInView={{ width: `${benchmark.percentile}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, ease: EDITORIAL_EASE }}
                className={cn("absolute inset-y-0 left-0", benchmark.percentile >= 70 ? "bg-emerald-600/70" : "bg-amber-500/80")}
              />
              <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/25" title="median" />
            </div>
          </div>
        </div>
      ))}
      <Caption className="pt-1">Median of 1,240 similar-size B2B SaaS projects on Hexclave, anonymized</Caption>
    </div>
  );
}

// ─── 11 · One thing to fix today ──────────────────────────────────────────────

export function OneThingChapter() {
  const [done, setDone] = useState(false);
  return (
    <div className="border border-black/[0.1] px-7 py-9 dark:border-white/[0.12] sm:px-10">
      <div className="flex items-center gap-2">
        <FireSimpleIcon className="h-4 w-4 text-foreground/60" weight="fill" />
        <Caption>If you do nothing else before lunch</Caption>
      </div>
      <p className={cn("mt-4 max-w-[24ch] text-3xl leading-[1.15] text-foreground sm:text-4xl", SERIF)}>
        {ONE_THING.headline}
      </p>
      <p className="mt-4 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">{ONE_THING.reasoning}</p>
      <div className="mt-6">
        {done ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
            <CheckIcon className="h-3.5 w-3.5" weight="bold" />
            Deploy queued — watching it for you
          </span>
        ) : (
          <RuledButton onClick={() => setDone(true)}>{ONE_THING.cta}</RuledButton>
        )}
      </div>
    </div>
  );
}

// ─── 12 · Delivery colophon ───────────────────────────────────────────────────

export function DeliveryColophon() {
  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <div className="flex flex-wrap items-baseline justify-center gap-x-8 gap-y-2">
        {DELIVERY_CHANNELS.map((channel) => (
          <span key={channel.id} className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-foreground">{channel.label}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/35">{channel.note}</span>
          </span>
        ))}
      </div>
      <p className={cn("max-w-[52ch] text-sm leading-relaxed text-foreground/50", SERIF)}>
        Made for you by Hexclave, using your events, replays, billing, and audit log. Tomorrow&apos;s edition
        arrives at 07:00.
      </p>
    </div>
  );
}
