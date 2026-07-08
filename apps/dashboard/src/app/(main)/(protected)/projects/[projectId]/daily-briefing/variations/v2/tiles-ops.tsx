"use client";

// Ops tiles: security (world dots, radar scan, posture), sales plays, drafted
// emails (paper-plane send), incident waterfall, team pulse, benchmark,
// one-thing-to-fix, and delivery modes.

import { cn } from "@/components/ui";
import {
  CrosshairIcon,
  EnvelopeSimpleIcon,
  ChatCircleDotsIcon,
  CheckIcon,
  GlobeHemisphereWestIcon,
  LightningIcon,
  PaperPlaneTiltIcon,
  PrinterIcon,
  PulseIcon,
  RankingIcon,
  ShieldCheckIcon,
  TargetIcon,
  UsersThreeIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { fmtUsd } from "../../mock-data";
import {
  BENCHMARK,
  DRAFT_EMAILS,
  INCIDENT,
  LOGIN_DOTS,
  ONE_THING,
  SALES_PLAYS,
  SECURITY_POSTURE,
  TEAM_PULSE,
  UNUSUAL_LOGIN,
} from "./data";
import { EASE, Tile, TileLabel } from "./tile";

// ─── Security: world login dots ────────────────────────────────────────────────

export function LoginMapTile(props: { className?: string }) {
  return (
    <Tile accent="blue" className={props.className}>
      <TileLabel icon={<GlobeHemisphereWestIcon className="h-3.5 w-3.5" weight="bold" />}>Logins overnight</TileLabel>
      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-foreground/[0.03] ring-1 ring-black/[0.04] dark:bg-white/[0.02] dark:ring-white/[0.06]"
        style={{
          backgroundImage: "radial-gradient(currentColor 0.75px, transparent 0.75px)",
          backgroundSize: "11px 11px",
          color: "rgba(120,130,150,0.28)",
        }}
      >
        {LOGIN_DOTS.map((dot) => (
          <div key={dot.id} className="absolute" style={{ left: `${dot.x}%`, top: `${dot.y}%` }}>
            <span className="relative flex h-2 w-2">
              <span
                className={cn(
                  "absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping",
                  dot.ok ? "bg-emerald-500" : "bg-amber-500",
                )}
              />
              <span className={cn("relative inline-flex h-2 w-2 rounded-full", dot.ok ? "bg-emerald-500" : "bg-amber-500")} />
            </span>
            <span className="absolute left-3 top-[-3px] whitespace-nowrap font-mono text-[9px] text-foreground/50">
              {dot.city}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-snug text-foreground/60">
        <span className="font-medium text-amber-600 dark:text-amber-400">{UNUSUAL_LOGIN.split(":")[0]}:</span>
        {UNUSUAL_LOGIN.slice(UNUSUAL_LOGIN.indexOf(":") + 1)}
      </p>
    </Tile>
  );
}

// ─── Security: radar secret scan ───────────────────────────────────────────────

export function RadarScanTile(props: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <Tile accent="emerald" className={props.className}>
      <TileLabel icon={<CrosshairIcon className="h-3.5 w-3.5" weight="bold" />}>Secret scan</TileLabel>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="relative aspect-square h-full max-h-32">
          {/* concentric rings */}
          <div className="absolute inset-0 rounded-full border border-emerald-500/25" />
          <div className="absolute inset-[18%] rounded-full border border-emerald-500/20" />
          <div className="absolute inset-[36%] rounded-full border border-emerald-500/15" />
          <div className="absolute left-0 right-0 top-1/2 h-px bg-emerald-500/10" />
          <div className="absolute bottom-0 top-0 left-1/2 w-px bg-emerald-500/10" />
          {/* sweep */}
          <motion.div
            className="absolute inset-0 rounded-full [background:conic-gradient(from_0deg,rgba(16,185,129,0.4)_0deg,rgba(16,185,129,0.12)_46deg,transparent_70deg)]"
            animate={reduce ? undefined : { rotate: 360 }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }}
          />
          <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-center gap-1.5">
        <ShieldCheckIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" weight="fill" />
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
          All clear — 0 secrets exposed
        </span>
      </div>
      <p className="mt-1 text-center font-mono text-[10px] text-foreground/35">4,812 files · 96 repos · 06:02</p>
    </Tile>
  );
}

// ─── Security posture: MFA nudge + CVEs ────────────────────────────────────────

export function SecurityPostureTile(props: { className?: string }) {
  return (
    <Tile accent="amber" className={props.className}>
      <TileLabel icon={<ShieldCheckIcon className="h-3.5 w-3.5" weight="bold" />}>Posture</TileLabel>
      <div className="flex flex-1 flex-col justify-between gap-3">
        {SECURITY_POSTURE.map((row) => (
          <div key={row.id} className="rounded-xl bg-foreground/[0.03] px-3 py-2.5 dark:bg-white/[0.03]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-foreground/70">{row.label}</span>
              <span
                className={cn(
                  "font-mono text-sm font-semibold tabular-nums",
                  row.tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {row.value}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-foreground/50">{row.note}</p>
          </div>
        ))}
      </div>
    </Tile>
  );
}

// ─── Sales plays ───────────────────────────────────────────────────────────────

export function SalesPlaysTile(props: { className?: string }) {
  return (
    <Tile accent="purple" className={props.className}>
      <TileLabel icon={<TargetIcon className="h-3.5 w-3.5" weight="bold" />}>Sales plays — why now</TileLabel>
      <div className="flex flex-1 flex-col justify-between gap-2.5">
        {SALES_PLAYS.map((play, i) => (
          <div key={play.id} className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 font-mono text-[11px] font-semibold text-violet-600 dark:text-violet-400">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] leading-snug text-foreground">
                <span className="font-semibold">{play.account}</span>
                <span className="text-foreground/50"> — {play.play}</span>
              </p>
              <p className="text-xs leading-snug text-foreground/55">
                <LightningIcon className="mr-1 inline h-3 w-3 text-violet-500" weight="fill" />
                {play.why}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Tile>
  );
}

// ─── Drafted emails with paper-plane send ──────────────────────────────────────

export function DraftedEmailsTile(props: { className?: string, onSend: () => void }) {
  const [sent, setSent] = useState<Record<string, boolean>>({});

  const handleSend = (id: string) => {
    if (sent[id]) return;
    setSent((prev) => ({ ...prev, [id]: true }));
    props.onSend();
  };

  return (
    <Tile accent="cyan" className={props.className}>
      <TileLabel
        icon={<EnvelopeSimpleIcon className="h-3.5 w-3.5" weight="bold" />}
        right={<span className="font-mono text-[10px] text-foreground/40">drafted 05:58 by your agent</span>}
      >
        Ready to send
      </TileLabel>
      <div className="flex flex-1 flex-col justify-between gap-2">
        {DRAFT_EMAILS.map((email) => (
          <div
            key={email.id}
            className="flex items-center gap-3 rounded-xl bg-foreground/[0.03] px-3 py-2 dark:bg-white/[0.03]"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-foreground">
                <span className="font-medium">{email.subject}</span>
                <span className="ml-1.5 font-mono text-[11px] text-foreground/40">→ {email.to}</span>
              </p>
              <p className="truncate text-xs text-foreground/50">{email.preview}</p>
            </div>
            <button
              type="button"
              onClick={() => handleSend(email.id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px] font-medium transition-colors",
                sent[email.id]
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20 dark:text-cyan-300",
              )}
            >
              {sent[email.id] ? (
                <>
                  <CheckIcon className="h-3 w-3" weight="bold" /> Sent
                </>
              ) : (
                <>
                  <PaperPlaneTiltIcon className="h-3 w-3" weight="fill" /> Send
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </Tile>
  );
}

// ─── Incident waterfall ────────────────────────────────────────────────────────

const WATERFALL_TONE: Record<"ok" | "warn" | "bad", string> = {
  ok: "bg-emerald-500/70",
  warn: "bg-amber-500/80",
  bad: "bg-red-500/80",
};

export function IncidentTile(props: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <Tile accent="rose" className={props.className}>
      <TileLabel
        icon={<PulseIcon className="h-3.5 w-3.5" weight="bold" />}
        right={
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            <CheckIcon className="h-3 w-3" weight="bold" /> resolved {INCIDENT.resolvedAt}
          </span>
        }
      >
        Overnight incident
      </TileLabel>
      <p className="text-[13px] font-medium text-foreground">
        {INCIDENT.title}
        <span className="ml-2 font-mono text-[11px] font-normal tabular-nums text-foreground/40">{INCIDENT.window}</span>
      </p>
      <div className="mt-3 flex flex-1 flex-col justify-center gap-2">
        {INCIDENT.spans.map((span, i) => (
          <div key={span.id} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate font-mono text-[10px] text-foreground/50">{span.label}</span>
            <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.05]">
              <motion.div
                className={cn("absolute top-0 h-full rounded-full", WATERFALL_TONE[span.tone])}
                style={{ left: `${span.start}%` }}
                initial={reduce ? { width: `${span.width}%` } : { width: 0 }}
                animate={{ width: `${span.width}%` }}
                transition={{ duration: 0.7, delay: 0.4 + i * 0.15, ease: [...EASE] }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs leading-snug text-foreground/55">{INCIDENT.note}</p>
    </Tile>
  );
}

// ─── Team pulse ────────────────────────────────────────────────────────────────

export function TeamPulseTile(props: { className?: string }) {
  return (
    <Tile className={props.className}>
      <TileLabel icon={<UsersThreeIcon className="h-3.5 w-3.5" weight="bold" />}>Team pulse</TileLabel>
      <div className="flex flex-1 flex-col justify-between gap-2 font-mono text-[11px] leading-relaxed">
        {TEAM_PULSE.map((row) => (
          <p key={row.id} className="text-foreground/60">
            <span className="tabular-nums text-foreground/35">{row.time}</span>{" "}
            <span className="font-semibold text-foreground/80">{row.actor}</span> {row.action}
          </p>
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/30">from the audit log</p>
    </Tile>
  );
}

// ─── Benchmark ─────────────────────────────────────────────────────────────────

export function BenchmarkTile(props: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <Tile accent="purple" className={props.className}>
      <TileLabel icon={<RankingIcon className="h-3.5 w-3.5" weight="bold" />}>Benchmark</TileLabel>
      <div className="flex items-baseline gap-1">
        <span className="text-4xl font-semibold tracking-tight text-foreground tabular-nums">{BENCHMARK.percentile}</span>
        <span className="text-sm font-medium text-foreground/50">th percentile</span>
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-violet-500/60 to-violet-500"
          initial={reduce ? { width: `${BENCHMARK.percentile}%` } : { width: 0 }}
          animate={{ width: `${BENCHMARK.percentile}%` }}
          transition={{ duration: 1.1, delay: 0.5, ease: [...EASE] }}
        />
      </div>
      <p className="mt-3 text-xs leading-snug text-foreground/60">{BENCHMARK.line}</p>
      <p className="mt-auto font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/35">
        cohort: {BENCHMARK.cohort}
      </p>
    </Tile>
  );
}

// ─── One thing to fix ──────────────────────────────────────────────────────────

export function OneThingTile(props: { className?: string }) {
  return (
    <Tile accent="amber" glow className={props.className}>
      <TileLabel icon={<WrenchIcon className="h-3.5 w-3.5" weight="bold" />}>If you fix one thing today</TileLabel>
      <p className="text-xl font-semibold tracking-tight text-foreground">{ONE_THING.title}</p>
      <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-foreground/65">{ONE_THING.body}</p>
      <div className="mt-auto flex items-center gap-2 pt-3">
        <span className="rounded-full bg-amber-500/15 px-2.5 py-1 font-mono text-[11px] font-medium text-amber-700 dark:text-amber-300">
          impact {fmtUsd(210000)}/mo
        </span>
        <span className="rounded-full bg-foreground/[0.05] px-2.5 py-1 font-mono text-[11px] text-foreground/50">
          effort: one line
        </span>
      </div>
    </Tile>
  );
}

// ─── Delivery modes ────────────────────────────────────────────────────────────

export function DeliveryTile(props: { className?: string }) {
  return (
    <Tile className={props.className}>
      <TileLabel icon={<PaperPlaneTiltIcon className="h-3.5 w-3.5" weight="bold" />}>Get this briefing anywhere</TileLabel>
      <div className="grid flex-1 grid-cols-3 gap-2">
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-foreground/[0.03] py-3 dark:bg-white/[0.03]">
          <EnvelopeSimpleIcon className="h-5 w-5 text-blue-500" weight="duotone" />
          <span className="font-mono text-[10px] text-foreground/55">Email</span>
          <span className="font-mono text-[9px] text-emerald-600 dark:text-emerald-400">on · 07:00</span>
        </div>
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-foreground/[0.03] py-3 dark:bg-white/[0.03]">
          <ChatCircleDotsIcon className="h-5 w-5 text-emerald-500" weight="duotone" />
          <span className="font-mono text-[10px] text-foreground/55">iMessage</span>
          <span className="font-mono text-[9px] text-foreground/35">off</span>
        </div>
        {/* the fax prints on hover */}
        <div className="group/fax flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-foreground/[0.03] py-3 dark:bg-white/[0.03]">
          <div className="relative">
            <PrinterIcon className="h-5 w-5 text-amber-500" weight="duotone" />
            <span
              className="absolute left-1/2 top-full h-0 w-3.5 -translate-x-1/2 rounded-b-sm bg-foreground/25 transition-all duration-700 ease-out group-hover/fax:h-3.5 dark:bg-white/30"
              style={{ transitionTimingFunction: "cubic-bezier(0.32,0.72,0,1)" }}
            />
          </div>
          <span className="font-mono text-[10px] text-foreground/55 transition-transform duration-700 group-hover/fax:translate-y-2">
            Fax
          </span>
          <span className="font-mono text-[9px] text-foreground/35 transition-transform duration-700 group-hover/fax:translate-y-2">
            really
          </span>
        </div>
      </div>
    </Tile>
  );
}
