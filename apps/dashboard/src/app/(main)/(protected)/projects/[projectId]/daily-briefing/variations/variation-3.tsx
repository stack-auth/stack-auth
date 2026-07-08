"use client";

// Variation 3 — "TERMINAL": Bloomberg-terminal mission control.
// Dense, everything-mono command center. Dark: near-black phosphor. Light:
// warm paper terminal. All data is mock and deterministic (see ../mock-data).

import { CaretRightIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { BRIEFING_NOW_MS, fmtDay, MOCK_HEADLINE, MOCK_VIEWER, TICKER_EVENTS } from "../mock-data";
import { CANNED_RESPONSES } from "./v3/data";
import {
  AgentLogPanel,
  BenchmarksPanel,
  ChurnPanel,
  HeroNumbersPanel,
  IncidentPanel,
  OneThingPanel,
  OutboxPanel,
  ReplaysPanel,
  RevenuePanel,
  SalesPanel,
  SecurityPanel,
  SignupsPanel,
  SupportPanel,
  TeamPulsePanel,
} from "./v3/panels";
import { BlockCursor, Led, Rule, Scanlines, SIG, TermSwitch, TerminalStyles, TypeIn } from "./v3/ui";

// UTC clock with seconds; starts at the fixed anchor, ticks from useEffect.
const CLOCK_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function SessionClock() {
  const [nowMs, setNowMs] = useState(BRIEFING_NOW_MS);
  useEffect(() => {
    const interval = setInterval(() => setNowMs((t) => t + 1000), 1000);
    return () => clearInterval(interval);
  }, []);
  return <span className="tabular-nums">{CLOCK_FMT.format(new Date(nowMs))}Z</span>;
}

// ─── Top status bar ───────────────────────────────────────────────────────────

function StatusBar() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-foreground/15 px-4 py-2 text-[10px] tracking-[0.15em] dark:border-emerald-400/20">
      <span className={`font-semibold ${SIG.green}`}>BRIEFING v2.4.1</span>
      <span className={SIG.faint}>·</span>
      <span className={SIG.dim}>
        SESSION: <span className="font-semibold text-foreground">{MOCK_VIEWER.firstName.toUpperCase()}@{MOCK_VIEWER.projectName.replace(/\s+/g, "").toUpperCase()}</span>
      </span>
      <span className={SIG.faint}>·</span>
      <span className={SIG.dim}>{fmtDay(BRIEFING_NOW_MS).toUpperCase()}</span>
      <span className={SIG.faint}>·</span>
      <span className={SIG.green}>
        <SessionClock />
      </span>
      <span className="ml-auto flex items-center gap-2">
        <Led level="OK" pulse />
        <span className={`${SIG.green} font-semibold`}>ALL SYSTEMS NOMINAL</span>
        <BlockCursor className="h-[0.9em]" />
      </span>
    </div>
  );
}

// ─── Scrolling ticker marquee ─────────────────────────────────────────────────

const TICKER_KIND_CLASS: Record<string, string> = {
  signup: SIG.green,
  revenue: SIG.green,
  replay: SIG.amber,
  security: SIG.amber,
  system: SIG.dim,
};

function Ticker() {
  const reduce = useReducedMotion();
  const items = [...TICKER_EVENTS, ...TICKER_EVENTS]; // doubled for a seamless loop
  return (
    <div className="overflow-hidden border-b border-foreground/15 py-1.5 dark:border-emerald-400/20">
      <div
        className={`flex w-max gap-8 whitespace-nowrap text-[10px] tracking-wider ${reduce ? "" : "v3-anim"}`}
        style={reduce ? undefined : { animation: "v3-marquee 48s linear infinite" }}
      >
        {items.map((e, i) => (
          <span key={`${e.id}-${i}`} className="flex items-center gap-1.5" aria-hidden={i >= TICKER_EVENTS.length}>
            <span className={`font-semibold ${TICKER_KIND_CLASS[e.kind]}`}>{e.kind.toUpperCase()}</span>
            <span className={SIG.dim}>{e.text}</span>
            <span className={SIG.faint}>{"//"}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Boot header (typed-in cold open) ─────────────────────────────────────────

function BootHeader() {
  return (
    <div className="px-4 pb-4 pt-5">
      <div className={`text-[10px] tracking-[0.25em] ${SIG.faint}`}>
        <TypeIn text={"> INITIALIZING DAILY BRIEFING ............ OK"} speed={10} />
      </div>
      <h1 className="mt-2 max-w-3xl text-sm font-semibold leading-relaxed text-foreground sm:text-base">
        <span className={SIG.green}>{"MANTRA> "}</span>
        <TypeIn text={MOCK_HEADLINE} delayMs={450} speed={10} />
      </h1>
    </div>
  );
}

// ─── Command console + delivery modes ─────────────────────────────────────────

type ConsoleLine = { id: number, kind: "query" | "answer", text: string };

function CommandConsole() {
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const nextId = useRef(0);
  const answerIndex = useRef(0);

  const submit = () => {
    const q = input.trim();
    if (!q) return;
    const answer = CANNED_RESPONSES[answerIndex.current % CANNED_RESPONSES.length];
    answerIndex.current += 1;
    setLines((prev) => [
      ...prev.slice(-6),
      { id: nextId.current++, kind: "query", text: q },
      { id: nextId.current++, kind: "answer", text: answer },
    ]);
    setInput("");
  };

  return (
    <div className="border border-foreground/15 bg-white/55 p-3 dark:border-emerald-400/15 dark:bg-emerald-950/[0.14]">
      {lines.length > 0 && (
        <div className="mb-2 space-y-1 text-[11px]">
          {lines.map((l) => (
            <div key={l.id} className="flex gap-1.5">
              <span className={`shrink-0 font-semibold ${l.kind === "query" ? SIG.dim : SIG.green}`}>
                {l.kind === "query" ? ">" : "AI>"}
              </span>
              <span className={l.kind === "query" ? "text-foreground/80" : SIG.dim}>{l.text}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 text-[12px]">
        <CaretRightIcon size={12} weight="bold" className={`shrink-0 ${SIG.green}`} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="ask your briefing_"
          aria-label="Ask your briefing"
          className="w-full bg-transparent font-mono text-foreground caret-emerald-600 outline-none placeholder:text-foreground/35 dark:caret-emerald-400"
        />
        {input.length === 0 && <BlockCursor className="pointer-events-none -ml-[calc(100%-1rem)] h-[0.95em] sm:-ml-[calc(100%-1rem)]" />}
      </div>
    </div>
  );
}

function DeliveryModes() {
  const [modes, setModes] = useState({ email: true, imsg: true, fax: false });
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-foreground/15 bg-white/55 px-3 py-2.5 dark:border-emerald-400/15 dark:bg-emerald-950/[0.14]">
      <span className={`text-[9px] font-semibold tracking-[0.25em] ${SIG.faint}`}>DELIVERY MODES</span>
      <TermSwitch label="EMAIL" checked={modes.email} onChange={(v) => setModes((m) => ({ ...m, email: v }))} />
      <TermSwitch label="IMSG" checked={modes.imsg} onChange={(v) => setModes((m) => ({ ...m, imsg: v }))} />
      <TermSwitch label="FAX" checked={modes.fax} onChange={(v) => setModes((m) => ({ ...m, fax: v }))} />
      {modes.fax && <span className={`text-[9px] tracking-widest ${SIG.amber}`}>WARN: FAX QUEUE DEPTH 1997</span>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Variation3() {
  const reduce = useReducedMotion();
  return (
    <div className="relative min-h-screen bg-[#f7f4eb] font-mono text-foreground dark:bg-[#050807]">
      <TerminalStyles />
      <Scanlines />
      <motion.div
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 mx-auto max-w-7xl"
      >
        <StatusBar />
        <Ticker />
        <BootHeader />

        <main className="grid grid-cols-1 gap-3 px-4 lg:grid-cols-12">
          <HeroNumbersPanel span="lg:col-span-12" />

          <AgentLogPanel span="lg:col-span-5" />
          <RevenuePanel span="lg:col-span-7" />

          <SignupsPanel span="lg:col-span-4" />
          <ChurnPanel span="lg:col-span-4" />
          <ReplaysPanel span="lg:col-span-4" />

          <SupportPanel span="lg:col-span-6" />
          <SecurityPanel span="lg:col-span-6" />

          <SalesPanel span="lg:col-span-7" />
          <BenchmarksPanel span="lg:col-span-5" />

          <OutboxPanel span="lg:col-span-6" />
          <IncidentPanel span="lg:col-span-6" />

          <TeamPulsePanel span="lg:col-span-7" />
          <OneThingPanel span="lg:col-span-5" />
        </main>

        <footer className="space-y-3 px-4 pt-3">
          <CommandConsole />
          <DeliveryModes />
          <div className="pb-28 pt-1">
            <Rule label="END OF BRIEFING" />
            <div className={`mt-2 text-center text-[9px] tracking-[0.25em] ${SIG.faint}`}>
              GENERATED 07:30Z · ALL DATA SIMULATED · PRESS 1–5 TO SWITCH VARIATIONS
            </div>
          </div>
        </footer>
      </motion.div>
    </div>
  );
}
