"use client";

// The 14 content panels for Variation 3 — "TERMINAL".

import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CaretRightIcon,
  CopyIcon,
  EnvelopeSimpleIcon,
  FireIcon,
  PlayIcon,
  ShieldCheckIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import { useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCompact, fmtNum, fmtShortDay, fmtUsd, HERO_STATS, formatHeroStat } from "../../mock-data";
import {
  AGENT_LOG,
  ANOMALY_INDEX,
  BENCHMARKS,
  CHURN_ROWS,
  CHURN_TOTAL_CENTS,
  CVES,
  DRAFT_EMAILS,
  FIRE_TICKET,
  INCIDENT,
  MFA_COVERAGE,
  NOTABLE_SIGNUPS,
  ONE_THING,
  REPLAYS,
  REVENUE_HISTORY,
  REVENUE_SERIES,
  SALES_PLAYS,
  SIGNUP_HISTO,
  SUPPORT_THEMES,
  TEAM_PULSE,
  UNUSUAL_LOGINS,
} from "./data";
import { Led, Panel, Rule, SEVERITY_CLASS, SeverityChip, SIG, TickNumber, TypeIn } from "./ui";

const GREEN = "#10b981";
const AMBER = "#f59e0b";
const RED = "#ef4444";

// ─── [01] Overnight agent log ─────────────────────────────────────────────────

export function AgentLogPanel({ span }: { span?: string }) {
  return (
    <Panel index="01" title="OVERNIGHT AGENT LOG" span={span} right={<SeverityChip level="OK" />}>
      <ol className="space-y-1.5 text-[11px] leading-tight">
        {AGENT_LOG.map((line, i) => (
          <li key={line.id} className="flex items-baseline gap-2">
            <span className={`w-12 shrink-0 tabular-nums ${SIG.faint}`}>{line.ts}</span>
            <Led level={line.level} />
            <TypeIn text={line.text} delayMs={200 + i * 140} speed={6} className={line.level === "OK" ? "text-foreground/80" : SEVERITY_CLASS[line.level]} />
          </li>
        ))}
      </ol>
      <div className={`mt-2 border-t border-dashed border-foreground/15 pt-1.5 text-[10px] tracking-wider ${SIG.dim} dark:border-emerald-400/15`}>
        8 ACTIONS · 1 INCIDENT AUTO-RESOLVED · 0 NEEDED YOU
      </div>
    </Panel>
  );
}

// ─── [02] Hero numbers ────────────────────────────────────────────────────────

export function HeroNumbersPanel({ span }: { span?: string }) {
  return (
    <Panel index="02" title="KEY SIGNALS · LAST 24H" span={span}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
        {HERO_STATS.map((stat) => {
          const up = stat.deltaPct > 0;
          const flat = stat.deltaPct === 0;
          return (
            <div key={stat.id} className="min-w-0">
              <div className={`truncate text-[9px] uppercase tracking-[0.2em] ${SIG.faint}`}>{stat.label}</div>
              <div className="mt-0.5 text-lg font-semibold leading-none text-foreground">
                <TickNumber
                  value={stat.value}
                  format={(n) => formatHeroStat({ ...stat, value: stat.format === "percent" ? Math.round(n * 100) / 100 : Math.round(n) })}
                />
              </div>
              <div className={`mt-1 flex items-center gap-0.5 text-[10px] tabular-nums ${flat ? SIG.dim : up ? SIG.green : SIG.red}`}>
                {!flat && (up ? <ArrowUpRightIcon size={10} weight="bold" /> : <ArrowDownRightIcon size={10} weight="bold" />)}
                {flat ? "STEADY" : `${up ? "+" : ""}${stat.deltaPct.toFixed(1)}%`}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── [03] Revenue chart + signup histogram ────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean, payload?: { name?: string, value?: number }[], label?: number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-foreground/20 bg-background px-2 py-1 font-mono text-[10px] shadow-sm dark:border-emerald-400/30">
      <div className={SIG.dim}>{label !== undefined ? fmtShortDay(label) : ""}</div>
      {payload.map((p) =>
        p.value === undefined ? null : (
          <div key={p.name} className="tabular-nums text-foreground">
            {p.name === "forecast" ? "FCST " : "ACT  "}
            {fmtUsd(p.value)}
          </div>
        ),
      )}
    </div>
  );
}

export function RevenuePanel({ span }: { span?: string }) {
  const reduce = useReducedMotion();
  const anomaly = REVENUE_HISTORY[ANOMALY_INDEX];
  return (
    <Panel
      index="03"
      title="REVENUE · 21D + 7D FORECAST"
      span={span}
      right={
        <span className={`border border-red-600/40 px-1 py-px text-[9px] font-semibold tracking-widest ${SIG.red}`}>
          [ANOMALY] {fmtShortDay(anomaly.dayMs).toUpperCase()}
        </span>
      }
    >
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={REVENUE_SERIES} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="v3rev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={GREEN} stopOpacity={0.35} />
                <stop offset="100%" stopColor={GREEN} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="dayMs"
              tickFormatter={(v: number) => fmtShortDay(v)}
              tick={{ fontSize: 9, fill: "currentColor", opacity: 0.45 }}
              tickLine={false}
              axisLine={{ stroke: "currentColor", opacity: 0.15 }}
              minTickGap={36}
            />
            <YAxis
              tickFormatter={(v: number) => `$${fmtCompact(v / 100)}`}
              tick={{ fontSize: 9, fill: "currentColor", opacity: 0.45 }}
              tickLine={false}
              axisLine={false}
              width={42}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "currentColor", opacity: 0.2 }} />
            <Area
              type="step"
              dataKey="actual"
              name="actual"
              stroke={GREEN}
              strokeWidth={1.5}
              fill="url(#v3rev)"
              isAnimationActive={!reduce}
              animationDuration={900}
              connectNulls={false}
            />
            <Line
              type="step"
              dataKey="forecast"
              name="forecast"
              stroke={GREEN}
              strokeWidth={1.5}
              strokeDasharray="2 4"
              dot={false}
              isAnimationActive={!reduce}
              animationDuration={900}
              connectNulls={false}
            />
            <ReferenceDot x={anomaly.dayMs} y={anomaly.value} r={3.5} fill={RED} stroke="none" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className={`mt-1 text-[10px] ${SIG.dim}`}>
        <span className={SIG.red}>ANOMALY:</span> {fmtShortDay(anomaly.dayMs)} dipped to {fmtUsd(anomaly.value)} — payment provider retry storm, recovered next day.
      </div>
      <Rule label="SIGNUPS · 14D" />
      <div className="mt-1 h-16">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={SIGNUP_HISTO} margin={{ top: 2, right: 6, bottom: 0, left: 0 }}>
            <XAxis dataKey="dayMs" hide />
            <YAxis hide />
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="border border-foreground/20 bg-background px-2 py-1 font-mono text-[10px] tabular-nums dark:border-emerald-400/30">
                    {fmtNum(Number(payload[0].value))} signups
                  </div>
                ) : null
              }
              cursor={{ fill: "currentColor", opacity: 0.08 }}
            />
            <Bar dataKey="value" fill={GREEN} opacity={0.75} isAnimationActive={!reduce} animationDuration={700} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

// ─── [04] Notable signups ─────────────────────────────────────────────────────

export function SignupsPanel({ span }: { span?: string }) {
  return (
    <Panel index="04" title="NOTABLE SIGNUPS" span={span} right={<span className={`text-[10px] tabular-nums ${SIG.green}`}>+312</span>}>
      <ul className="space-y-2.5">
        {NOTABLE_SIGNUPS.map((s) => (
          <li key={s.id} className="text-[11px] leading-snug">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">{s.org}</span>
              <span className={`border border-foreground/20 px-1 text-[9px] tracking-widest ${SIG.dim}`}>{s.plan}</span>
              <span className={`truncate ${SIG.faint}`}>{s.who}</span>
            </div>
            <div className={`mt-0.5 flex gap-1.5 ${SIG.dim}`}>
              <span className={`shrink-0 ${SIG.green}`}>AI&gt;</span>
              <span>{s.blurb}</span>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ─── [05] Churn autopsy ───────────────────────────────────────────────────────

export function ChurnPanel({ span }: { span?: string }) {
  return (
    <Panel
      index="05"
      title="CHURN AUTOPSY"
      span={span}
      right={<span className={`text-[10px] tabular-nums ${SIG.red}`}>-{fmtUsd(CHURN_TOTAL_CENTS)}/mo</span>}
    >
      <ul className="space-y-2.5">
        {CHURN_ROWS.map((c) => (
          <li key={c.id} className="text-[11px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-foreground">{c.org}</span>
              <span className={`tabular-nums ${SIG.red}`}>-{fmtUsd(c.mrrCents)}</span>
            </div>
            <div className="mt-1 h-1 w-full bg-foreground/10">
              <div className="h-full bg-red-600/70 dark:bg-red-400/70" style={{ width: `${c.share * 100}%` }} />
            </div>
            <div className={`mt-1 ${SIG.dim}`}>CAUSE: {c.reason}</div>
          </li>
        ))}
      </ul>
      <div className={`mt-2.5 border-t border-dashed border-foreground/15 pt-1.5 text-[10px] ${SIG.dim} dark:border-emerald-400/15`}>
        PATTERN: 2 of 3 were preventable — rate-limit config + champion tracking.
      </div>
    </Panel>
  );
}

// ─── [06] Support digest + fire ticket ────────────────────────────────────────

export function SupportPanel({ span }: { span?: string }) {
  const [copied, setCopied] = useState(false);
  const max = Math.max(...SUPPORT_THEMES.map((t) => t.count));
  return (
    <Panel index="06" title="SUPPORT DIGEST" span={span} right={<SeverityChip level="WARN" />}>
      <ul className="space-y-1.5 text-[11px]">
        {SUPPORT_THEMES.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <span className="w-40 shrink-0 truncate text-foreground/80 sm:w-44">{t.theme}</span>
            <span className="h-1.5 flex-1 bg-foreground/10">
              <span className="block h-full bg-amber-600/70 dark:bg-amber-400/70" style={{ width: `${(t.count / max) * 100}%` }} />
            </span>
            <span className={`w-6 text-right tabular-nums ${SIG.dim}`}>{t.count}</span>
            <span className={`w-7 text-right tabular-nums text-[10px] ${t.delta > 0 ? SIG.amber : t.delta < 0 ? SIG.green : SIG.faint}`}>
              {t.delta > 0 ? `+${t.delta}` : t.delta}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 border border-red-600/35 bg-red-600/[0.04] p-2 dark:border-red-400/35 dark:bg-red-400/[0.05]">
        <div className={`flex items-center gap-1.5 text-[10px] font-semibold tracking-widest ${SIG.red}`}>
          <FireIcon size={11} weight="fill" /> FIRE TICKET {FIRE_TICKET.id} · {FIRE_TICKET.plan} · {FIRE_TICKET.age} OLD
        </div>
        <p className="mt-1 text-[11px] leading-snug text-foreground/80">
          <span className={SIG.faint}>{FIRE_TICKET.from}:</span> {FIRE_TICKET.text}
        </p>
        <div className="mt-2 border-t border-dashed border-red-600/25 pt-1.5 dark:border-red-400/25">
          <div className={`flex items-center justify-between text-[9px] tracking-[0.2em] ${SIG.dim}`}>
            <span>
              <span className={SIG.green}>AI&gt;</span> SUGGESTED REPLY
            </span>
            <button
              type="button"
              onClick={() => setCopied(true)}
              className={`flex items-center gap-1 border px-1.5 py-px tracking-widest transition-colors ${
                copied
                  ? "border-emerald-600/50 text-emerald-700 dark:border-emerald-400/50 dark:text-emerald-400"
                  : "border-foreground/25 text-foreground/60 hover:border-foreground/50 hover:text-foreground"
              }`}
            >
              <CopyIcon size={10} /> {copied ? "COPIED" : "[COPY]"}
            </button>
          </div>
          <p className={`mt-1 text-[10.5px] leading-snug ${SIG.dim}`}>{FIRE_TICKET.suggestedReply}</p>
        </div>
      </div>
    </Panel>
  );
}

// ─── [07] Replays ─────────────────────────────────────────────────────────────

export function ReplaysPanel({ span }: { span?: string }) {
  return (
    <Panel index="07" title="REPLAYS WORTH WATCHING" span={span} right={<span className={`text-[10px] tracking-widest ${SIG.amber}`}>RAGE DETECTED</span>}>
      <ul className="space-y-2">
        {REPLAYS.map((r) => (
          <li key={r.id} className="flex items-start gap-2 text-[11px]">
            <button
              type="button"
              className={`mt-px flex size-5 shrink-0 items-center justify-center border border-emerald-600/40 transition-colors hover:bg-emerald-600/10 dark:border-emerald-400/40 dark:hover:bg-emerald-400/10 ${SIG.green}`}
              aria-label={`Play replay of ${r.route}`}
            >
              <PlayIcon size={9} weight="fill" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-foreground">{r.route}</span>
                <span className={`tabular-nums ${SIG.faint}`}>{r.duration}</span>
                <span className={`tabular-nums text-[10px] ${SIG.amber}`}>{r.rageClicks}x RAGE</span>
              </div>
              <div className={`${SIG.dim}`}>{r.note}</div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ─── [08] Security ────────────────────────────────────────────────────────────

export function SecurityPanel({ span }: { span?: string }) {
  const reduce = useReducedMotion();
  const mfaPct = Math.round((MFA_COVERAGE.enrolled / MFA_COVERAGE.total) * 100);
  return (
    <Panel index="08" title="SECURITY REPORT" span={span} right={<ShieldCheckIcon size={12} className={SIG.green} />}>
      <div className="flex items-center gap-2 text-[10px] tracking-widest">
        <span className={SIG.dim}>SECRET SCAN</span>
        <span className="relative h-px flex-1 overflow-hidden bg-foreground/15">
          {!reduce && (
            <span
              className="v3-anim absolute top-0 h-px w-[30%] bg-emerald-600 dark:bg-emerald-400"
              style={{ animation: "v3-sweep 2.4s linear infinite" }}
            />
          )}
        </span>
        <span className={`font-semibold ${SIG.green}`}>CLEAR · 0/214</span>
      </div>

      <ul className="mt-3 space-y-1.5 text-[10.5px]">
        {UNUSUAL_LOGINS.map((l) => (
          <li key={l.id} className="flex items-center gap-2">
            <Led level={l.level} />
            <span className="w-32 shrink-0 truncate text-foreground/80">{l.who}</span>
            <span className={`hidden w-40 shrink-0 tabular-nums sm:inline ${SIG.faint}`}>{l.coords}</span>
            <span className={`truncate ${SIG.dim}`}>
              {l.place} · {l.device}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-2 text-[10.5px]">
        <SeverityChip level="WARN" />
        <span className="text-foreground/80">
          MFA at {mfaPct}% ({MFA_COVERAGE.enrolled}/{MFA_COVERAGE.total}) — nudge the 5 holdouts, draft queued in [10].
        </span>
      </div>

      <Rule label="CVE WATCH" />
      <ul className="mt-1.5 space-y-1 text-[10.5px]">
        {CVES.map((c) => (
          <li key={c.id} className="flex items-baseline gap-2">
            <span className={`w-9 shrink-0 text-[9px] font-semibold tracking-widest ${SEVERITY_CLASS[c.sev]}`}>{c.sev}</span>
            <span className="shrink-0 text-foreground/80">{c.pkg}</span>
            <span className={`truncate ${SIG.faint}`}>{c.note}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ─── [09] Sales plays ─────────────────────────────────────────────────────────

export function SalesPanel({ span }: { span?: string }) {
  return (
    <Panel index="09" title="SALES PLAYS · RANKED" span={span}>
      <table className="w-full border-collapse text-left text-[10.5px]">
        <thead>
          <tr className={`text-[9px] tracking-[0.2em] ${SIG.faint}`}>
            <th className="pb-1.5 pr-2 font-semibold">#</th>
            <th className="pb-1.5 pr-2 font-semibold">ACCOUNT / PLAY</th>
            <th className="pb-1.5 pr-2 font-semibold">WHY-NOW</th>
            <th className="pb-1.5 text-right font-semibold">EST/YR</th>
          </tr>
        </thead>
        <tbody className="align-top">
          {SALES_PLAYS.map((p) => (
            <tr key={p.rank} className="border-t border-dashed border-foreground/10 dark:border-emerald-400/10">
              <td className={`py-1.5 pr-2 tabular-nums ${SIG.green}`}>{p.rank}</td>
              <td className="py-1.5 pr-2">
                <div className="font-semibold text-foreground">{p.org}</div>
                <div className={SIG.dim}>{p.play}</div>
              </td>
              <td className={`py-1.5 pr-2 ${SIG.dim}`}>{p.whyNow}</td>
              <td className={`py-1.5 text-right tabular-nums ${SIG.green}`}>{fmtUsd(p.valueCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// ─── [10] Outbox / drafted emails ─────────────────────────────────────────────

type SendState = "PENDING" | "SENDING" | "SENT";

export function OutboxPanel({ span }: { span?: string }) {
  const [states, setStates] = useState<Record<string, SendState>>({});

  const send = (id: string) => {
    setStates((s) => ({ ...s, [id]: "SENDING" }));
    setTimeout(() => setStates((s) => ({ ...s, [id]: "SENT" })), 900);
  };

  const sentCount = DRAFT_EMAILS.filter((e) => states[e.id] === "SENT").length;

  return (
    <Panel
      index="10"
      title="OUTBOX · DRAFTED BY AGENT"
      span={span}
      right={
        <span className={`text-[10px] tabular-nums tracking-widest ${sentCount === DRAFT_EMAILS.length ? SIG.green : SIG.dim}`}>
          {sentCount}/{DRAFT_EMAILS.length} SENT
        </span>
      }
    >
      <ul className="space-y-2">
        {DRAFT_EMAILS.map((e) => {
          const state: SendState = states[e.id] ?? "PENDING";
          return (
            <li
              key={e.id}
              className={`flex items-start gap-2.5 border p-2 text-[10.5px] transition-colors duration-500 ${
                state === "SENT"
                  ? "border-emerald-600/45 bg-emerald-600/10 dark:border-emerald-400/45 dark:bg-emerald-400/10"
                  : "border-foreground/15 dark:border-emerald-400/15"
              }`}
            >
              <EnvelopeSimpleIcon size={13} className={`mt-px shrink-0 ${state === "SENT" ? SIG.green : SIG.dim}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`truncate ${SIG.faint}`}>TO: {e.to}</span>
                </div>
                <div className="truncate font-semibold text-foreground">{e.subject}</div>
                <div className={`truncate ${SIG.dim}`}>{e.preview}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className={`text-[9px] font-semibold tracking-widest ${
                    state === "SENT" ? SIG.green : state === "SENDING" ? SIG.amber : SIG.dim
                  }`}
                >
                  {state}
                </span>
                <button
                  type="button"
                  disabled={state !== "PENDING"}
                  onClick={() => send(e.id)}
                  className={`border px-1.5 py-px text-[9px] font-semibold tracking-widest transition-colors ${
                    state === "PENDING"
                      ? "border-emerald-600/50 text-emerald-700 hover:bg-emerald-600/10 dark:border-emerald-400/50 dark:text-emerald-400 dark:hover:bg-emerald-400/10"
                      : "cursor-default border-foreground/15 text-foreground/30"
                  }`}
                >
                  {state === "SENT" ? "[DONE]" : state === "SENDING" ? "[...]" : "[SEND]"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ─── [11] Incident waterfall ──────────────────────────────────────────────────

export function IncidentPanel({ span }: { span?: string }) {
  return (
    <Panel
      index="11"
      title={`INCIDENT REPORT ${INCIDENT.id}`}
      span={span}
      right={<span className={`text-[10px] font-semibold tracking-widest ${SIG.green}`}>RESOLVED {INCIDENT.resolvedAt}</span>}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[10.5px]">
        <span className="font-semibold text-foreground">{INCIDENT.title}</span>
        <span className={SIG.faint}>
          {INCIDENT.openedAt} → {INCIDENT.resolvedAt} · {INCIDENT.durationLabel}
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        {INCIDENT.spans.map((s) => {
          const left = (s.startMs / INCIDENT.totalMs) * 100;
          const width = Math.max(2, (s.durMs / INCIDENT.totalMs) * 100);
          const barColor =
            s.level === "OK"
              ? "bg-emerald-600/70 dark:bg-emerald-400/70"
              : s.level === "WARN"
                ? "bg-amber-600/70 dark:bg-amber-400/70"
                : "bg-red-600/70 dark:bg-red-400/70";
          return (
            <div key={s.id} className="flex items-center gap-2 text-[10px]">
              <span className={`w-40 shrink-0 truncate sm:w-44 ${SIG.dim}`}>{s.name}</span>
              <div className="relative h-2.5 flex-1 bg-foreground/[0.06]">
                <div className={`absolute inset-y-0 ${barColor}`} style={{ left: `${left}%`, width: `${width}%` }} />
              </div>
              <span className={`w-12 shrink-0 text-right tabular-nums ${SIG.faint}`}>{Math.round(s.durMs / 1000)}s</span>
            </div>
          );
        })}
      </div>
      <div className={`mt-2.5 border-t border-dashed border-foreground/15 pt-1.5 text-[10.5px] dark:border-emerald-400/15 ${SIG.dim}`}>
        ROOT CAUSE: {INCIDENT.rootCause}. <span className={SIG.green}>NO ACTION REQUIRED.</span>
      </div>
    </Panel>
  );
}

// ─── [12] Team pulse ──────────────────────────────────────────────────────────

export function TeamPulsePanel({ span }: { span?: string }) {
  return (
    <Panel index="12" title="TEAM PULSE · AUDIT TAIL" span={span}>
      <ol className="space-y-1.5 text-[10.5px]">
        {TEAM_PULSE.map((p) => (
          <li key={p.id} className="flex items-baseline gap-2">
            <span className={SIG.green}>~</span>
            <span className="shrink-0 font-semibold text-foreground/85">{p.who}</span>
            <span className={`truncate ${SIG.dim}`}>{p.action}</span>
            <span className={`ml-auto shrink-0 tabular-nums ${SIG.faint}`}>{p.ts}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// ─── [13] Benchmarks ──────────────────────────────────────────────────────────

export function BenchmarksPanel({ span }: { span?: string }) {
  return (
    <Panel index="13" title="BENCHMARKS · VS 2,140 PEERS" span={span}>
      <ul className="space-y-2.5">
        {BENCHMARKS.map((b) => {
          const good = b.percentile >= 60;
          return (
            <li key={b.id} className="text-[10.5px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-foreground/80">{b.metric}</span>
                <span className="flex items-baseline gap-2 tabular-nums">
                  <span className="font-semibold text-foreground">{b.valueLabel}</span>
                  <span className={good ? SIG.green : SIG.amber}>P{b.percentile}</span>
                </span>
              </div>
              <div className="relative mt-1 h-1.5 w-full bg-foreground/10">
                <div
                  className={`h-full ${good ? "bg-emerald-600/70 dark:bg-emerald-400/70" : "bg-amber-600/70 dark:bg-amber-400/70"}`}
                  style={{ width: `${b.percentile}%` }}
                />
                <div className="absolute inset-y-[-2px] w-px bg-foreground/40" style={{ left: "50%" }} title="median" />
              </div>
            </li>
          );
        })}
      </ul>
      <div className={`mt-2 text-[9px] tracking-[0.2em] ${SIG.faint}`}>| = PEER MEDIAN (P50)</div>
    </Panel>
  );
}

// ─── [14] One thing to fix ────────────────────────────────────────────────────

export function OneThingPanel({ span }: { span?: string }) {
  return (
    <Panel index="14" title="ONE THING TO FIX TODAY" span={span} right={<SeverityChip level="CRIT" />}>
      <div className="border border-amber-600/40 bg-amber-600/[0.05] p-2.5 dark:border-amber-400/40 dark:bg-amber-400/[0.06]">
        <div className="flex items-start gap-2">
          <WrenchIcon size={14} className={`mt-px shrink-0 ${SIG.amber}`} />
          <div className="min-w-0 text-[11px]">
            <div className="font-semibold text-foreground">{ONE_THING.title}</div>
            <div className={`mt-1 ${SIG.dim}`}>IMPACT: {ONE_THING.impact}</div>
            <div className={`mt-1.5 flex items-start gap-1.5 ${SIG.green}`}>
              <CaretRightIcon size={11} weight="bold" className="mt-0.5 shrink-0" />
              <span>FIX: {ONE_THING.fix}</span>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
