"use client";

// People/product tiles: live ticker, agent log with drawing checkmarks,
// notable signups, churn autopsy, support digest, and the replay mini-screens.

import { cn } from "@/components/ui";
import {
  BroadcastIcon,
  CursorClickIcon,
  FireIcon,
  LifebuoyIcon,
  RobotIcon,
  SkullIcon,
  SparkleIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { fmtUsd, TICKER_EVENTS } from "../../mock-data";
import { AGENT_ACTIONS, CHURN_ROWS, FIRE_TICKET, NOTABLE_SIGNUPS, REPLAYS, SUPPORT_THEMES } from "./data";
import { EASE, Tile, TileLabel } from "./tile";

// ─── Live ticker ───────────────────────────────────────────────────────────────

const TICKER_KIND_COLOR: Record<string, string> = {
  signup: "bg-emerald-500",
  revenue: "bg-violet-500",
  replay: "bg-cyan-500",
  security: "bg-amber-500",
  system: "bg-slate-400",
};

export function TickerTile(props: { className?: string }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % TICKER_EVENTS.length), 2400);
    return () => clearInterval(timer);
  }, [reduce]);

  const visible = [0, 1, 2].map((offset) => TICKER_EVENTS[(index + offset) % TICKER_EVENTS.length]);

  return (
    <Tile accent="cyan" className={props.className}>
      <TileLabel
        icon={<BroadcastIcon className="h-3.5 w-3.5" weight="bold" />}
        right={
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            LIVE
          </span>
        }
      >
        Happening now
      </TileLabel>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          {visible.map((event, i) => (
            <motion.div
              key={event.id}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: i === 0 ? 1 : 0.45, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.45, ease: [...EASE] }}
              className="flex items-start gap-2.5"
            >
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", TICKER_KIND_COLOR[event.kind])} />
              <span className="text-[13px] leading-snug text-foreground/80">{event.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Tile>
  );
}

// ─── Agent log with drawing checkmarks ─────────────────────────────────────────

function DrawnCheck(props: { delay: number }) {
  const reduce = useReducedMotion();
  return (
    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
      <svg viewBox="0 0 14 14" className="h-2.5 w-2.5">
        <motion.path
          d="M2.5 7.5 L5.5 10.5 L11.5 3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-emerald-600 dark:text-emerald-400"
          initial={reduce ? undefined : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, delay: props.delay, ease: [...EASE] }}
        />
      </svg>
    </span>
  );
}

export function AgentLogTile(props: { className?: string }) {
  return (
    <Tile accent="emerald" className={props.className}>
      <TileLabel icon={<RobotIcon className="h-3.5 w-3.5" weight="bold" />}>While you slept</TileLabel>
      <p className="mb-4 text-lg font-semibold tracking-tight text-foreground">
        Your agent took <span className="text-emerald-600 dark:text-emerald-400">4 actions</span> overnight
      </p>
      <div className="flex flex-1 flex-col justify-between gap-3">
        {AGENT_ACTIONS.map((action, i) => (
          <div key={action.id} className="flex items-start gap-2.5">
            <DrawnCheck delay={0.5 + i * 0.35} />
            <div className="min-w-0">
              <span className="font-mono text-[10px] tabular-nums text-foreground/40">{action.time}</span>
              <p className="text-[13px] leading-snug text-foreground/80">{action.text}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/35">
        0 actions needed your approval
      </p>
    </Tile>
  );
}

// ─── Notable signups ───────────────────────────────────────────────────────────

export function NotableSignupsTile(props: { className?: string }) {
  return (
    <Tile accent="blue" className={props.className}>
      <TileLabel icon={<UserPlusIcon className="h-3.5 w-3.5" weight="bold" />}>Signups worth a look</TileLabel>
      <div className="flex flex-1 flex-col justify-between gap-3">
        {NOTABLE_SIGNUPS.map((signup) => (
          <div key={signup.id} className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
              {signup.company.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-foreground">
                {signup.name}
                <span className="ml-1.5 font-mono text-[11px] font-normal text-foreground/40">{signup.email}</span>
              </p>
              <p className="text-xs leading-snug text-foreground/60">
                <SparkleIcon className="mr-1 inline h-3 w-3 text-blue-500" weight="fill" />
                {signup.blurb}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Tile>
  );
}

// ─── Churn autopsy ─────────────────────────────────────────────────────────────

export function ChurnTile(props: { className?: string }) {
  const lost = CHURN_ROWS.reduce((sum, row) => sum + row.mrr, 0);
  return (
    <Tile accent="rose" className={props.className}>
      <TileLabel
        icon={<SkullIcon className="h-3.5 w-3.5" weight="bold" />}
        right={<span className="font-mono text-[11px] tabular-nums text-red-600 dark:text-red-400">-{fmtUsd(lost)}/mo</span>}
      >
        Churn autopsy
      </TileLabel>
      <div className="flex flex-1 flex-col justify-between gap-2.5">
        {CHURN_ROWS.map((row) => (
          <div key={row.id} className="rounded-xl bg-foreground/[0.03] px-3 py-2 dark:bg-white/[0.03]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-foreground">{row.company}</span>
              <span className="font-mono text-[11px] tabular-nums text-red-600/80 dark:text-red-400/80">
                -{fmtUsd(row.mrr)}
              </span>
            </div>
            <p className="text-xs leading-snug text-foreground/55">{row.reason}</p>
          </div>
        ))}
      </div>
    </Tile>
  );
}

// ─── Support digest ────────────────────────────────────────────────────────────

export function SupportTile(props: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <Tile accent="amber" className={props.className}>
      <TileLabel icon={<LifebuoyIcon className="h-3.5 w-3.5" weight="bold" />}>Support themes</TileLabel>
      <div className="flex flex-col gap-2">
        {SUPPORT_THEMES.map((theme, i) => (
          <div key={theme.id}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs font-medium text-foreground/75">{theme.label}</span>
              <span className="font-mono text-[11px] tabular-nums text-foreground/40">{theme.count}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]">
              <motion.div
                className="h-full rounded-full bg-amber-500/80"
                initial={reduce ? { width: `${theme.pct}%` } : { width: 0 }}
                animate={{ width: `${theme.pct}%` }}
                transition={{ duration: 0.9, delay: 0.4 + i * 0.15, ease: [...EASE] }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-auto rounded-xl bg-red-500/[0.07] p-3 ring-1 ring-red-500/20">
        <div className="mb-1 flex items-center gap-1.5">
          <FireIcon className="h-3.5 w-3.5 text-red-500" weight="fill" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-red-600 dark:text-red-400">
            {FIRE_TICKET.id} — handle first
          </span>
        </div>
        <p className="text-xs leading-snug text-foreground/75">
          <span className="font-mono text-foreground/50">{FIRE_TICKET.from}</span> — {FIRE_TICKET.text}
        </p>
      </div>
    </Tile>
  );
}

// ─── Replay mini-screens ───────────────────────────────────────────────────────

function MiniScreen(props: { kind: "smooth" | "rage" }) {
  const reduce = useReducedMotion();
  const rage = props.kind === "rage";
  return (
    <motion.div
      className="relative h-full w-full overflow-hidden rounded-lg bg-slate-900 ring-1 ring-white/10 dark:bg-black/60"
      animate={
        reduce || !rage
          ? undefined
          : { x: [0, 0, -3, 3, -2, 2, 0, 0] }
      }
      transition={rage ? { duration: 2.2, times: [0, 0.55, 0.62, 0.69, 0.76, 0.83, 0.9, 1], repeat: Infinity, repeatDelay: 0.8 } : undefined}
    >
      {/* fake UI chrome */}
      <div className="flex items-center gap-1 px-2 pt-1.5">
        <span className="h-1 w-1 rounded-full bg-white/25" />
        <span className="h-1 w-1 rounded-full bg-white/25" />
        <span className="h-1 w-1 rounded-full bg-white/25" />
      </div>
      <div className="space-y-1 px-2 pt-1.5">
        <div className="h-1 w-3/4 rounded bg-white/15" />
        <div className="h-1 w-1/2 rounded bg-white/10" />
        <div className={cn("mt-1.5 h-3 w-10 rounded", rage ? "bg-red-400/40" : "bg-emerald-400/40")} />
      </div>
      {/* moving cursor */}
      {!reduce && (
        <motion.span
          className="absolute h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
          animate={
            rage
              ? { left: ["70%", "34%", "34%", "34%", "34%"], top: ["20%", "62%", "58%", "64%", "60%"] }
              : { left: ["15%", "60%", "40%", "75%"], top: ["25%", "40%", "70%", "55%"] }
          }
          transition={{ duration: rage ? 2.2 : 4.5, repeat: Infinity, repeatDelay: rage ? 0.8 : 0, ease: "easeInOut" }}
        />
      )}
      {rage && !reduce && (
        <motion.span
          className="absolute left-[30%] top-[52%] h-4 w-4 rounded-full border border-red-400"
          animate={{ scale: [0.3, 1.6], opacity: [0.9, 0] }}
          transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 0.4 }}
        />
      )}
    </motion.div>
  );
}

export function ReplaysTile(props: { className?: string }) {
  return (
    <Tile accent="cyan" className={props.className}>
      <TileLabel icon={<CursorClickIcon className="h-3.5 w-3.5" weight="bold" />}>Replays worth watching</TileLabel>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        {REPLAYS.map((replay) => (
          <div key={replay.id} className="flex min-h-0 flex-col gap-1.5">
            <div className="min-h-0 flex-1">
              <MiniScreen kind={replay.kind} />
            </div>
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate font-mono text-[10px] text-foreground/55">{replay.label}</span>
              <span className="font-mono text-[10px] tabular-nums text-foreground/35">{replay.duration}</span>
            </div>
            {replay.kind === "rage" ? (
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-red-500">
                9 rage clicks
              </span>
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">
                clean checkout
              </span>
            )}
          </div>
        ))}
      </div>
    </Tile>
  );
}
