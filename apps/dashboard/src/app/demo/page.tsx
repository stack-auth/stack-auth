"use client";

import { cn } from "@/lib/utils";
import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  ClockIcon,
  EnvelopeSimpleIcon,
  PaperPlaneTiltIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

const PROJECT_NAME = "Acme Auth";

/* ------------------------------------------------------------------ */
/* Briefing card data                                                  */
/* ------------------------------------------------------------------ */

type BriefingCard = {
  eyebrow: string,
  title: string,
  accent: string,
  wash: string,
  textFirst?: boolean,
  hero?: { value: string, label: string },
  viz: "spark" | "bars" | "ring" | "funnel" | "list",
};

const CARDS: BriefingCard[] = [
  {
    eyebrow: "Daily briefing",
    title: `A quiet night for ${PROJECT_NAME}`,
    accent: "#67e8f9",
    wash: "radial-gradient(120% 90% at 15% 0%, #22d3ee 0%, transparent 55%), radial-gradient(120% 110% at 100% 30%, #6366f1 0%, transparent 60%), radial-gradient(140% 120% at 40% 110%, #10b981 0%, transparent 55%), #0b3b66",
    hero: { value: "99.98%", label: "uptime overnight" },
    viz: "spark",
  },
  {
    eyebrow: "What changed",
    title: "Yesterday, in one diff",
    accent: "#fda4af",
    wash: "radial-gradient(120% 90% at 10% 0%, #fb923c 0%, transparent 55%), radial-gradient(130% 110% at 100% 25%, #e11d48 0%, transparent 60%), radial-gradient(140% 130% at 30% 115%, #7c3aed 0%, transparent 60%), #57123c",
    textFirst: true,
    hero: { value: "+18", label: "new users" },
    viz: "bars",
  },
  {
    eyebrow: "Security pulse",
    title: "Access changes, reviewed",
    accent: "#6ee7b7",
    wash: "radial-gradient(120% 90% at 20% 0%, #34d399 0%, transparent 55%), radial-gradient(130% 110% at 100% 35%, #0d9488 0%, transparent 62%), radial-gradient(140% 120% at 45% 115%, #0ea5e9 0%, transparent 58%), #06403e",
    viz: "ring",
  },
  {
    eyebrow: "Lifecycle",
    title: "Momentum in the funnel",
    accent: "#a5b4fc",
    wash: "radial-gradient(120% 90% at 15% 0%, #60a5fa 0%, transparent 55%), radial-gradient(130% 110% at 100% 30%, #4f46e5 0%, transparent 60%), radial-gradient(150% 130% at 35% 115%, #06b6d4 0%, transparent 58%), #1e2a78",
    textFirst: true,
    hero: { value: "25%", label: "activation rate" },
    viz: "funnel",
  },
  {
    eyebrow: "Today",
    title: "Three useful moves",
    accent: "#fcd34d",
    wash: "radial-gradient(120% 90% at 15% 0%, #facc15 0%, transparent 52%), radial-gradient(130% 110% at 100% 30%, #f97316 0%, transparent 60%), radial-gradient(150% 130% at 40% 115%, #10b981 0%, transparent 55%), #713f12",
    viz: "list",
  },
];

/* ------------------------------------------------------------------ */
/* Micro-visualizations (single series, white marks on gradient)       */
/* ------------------------------------------------------------------ */

const SPARK_DATA = [3, 2, 4, 2, 3, 2, 2, 1, 2, 1, 1, 1];
const BAR_DATA = [6, 9, 4, 11, 8, 14, 18];
const FUNNEL_ROWS: [string, number][] = [["Joined", 12], ["Activated", 3], ["Recheck", 1]];
const LIST_ROWS = ["Review failed webhooks", "Finish project setup", "Enable passkeys"];

function MicroSpark(props: { id: string, width?: number, height?: number }) {
  const w = props.width ?? 192;
  const h = props.height ?? 48;
  const max = Math.max(...SPARK_DATA);
  const min = Math.min(...SPARK_DATA);
  const px = (i: number) => 3 + (i / (SPARK_DATA.length - 1)) * (w - 6);
  const py = (v: number) => h - 5 - ((v - min) / (max - min || 1)) * (h - 12);
  const pts = SPARK_DATA.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" L");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <defs>
        <linearGradient id={props.id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.4)" />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <path d={`M${pts} L${w - 3},${h} L3,${h} Z`} fill={`url(#${props.id})`} />
      <path d={`M${pts}`} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={px(SPARK_DATA.length - 1)} cy={py(SPARK_DATA[SPARK_DATA.length - 1])} r={3.2} fill="#fff" />
    </svg>
  );
}

function MicroBars(props: { width?: number, height?: number }) {
  const w = props.width ?? 192;
  const h = props.height ?? 48;
  const max = Math.max(...BAR_DATA);
  const gap = 3;
  const bw = (w - gap * (BAR_DATA.length - 1)) / BAR_DATA.length;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {BAR_DATA.map((v, i) => {
        const bh = Math.max(4, (v / max) * (h - 2));
        return (
          <rect
            key={i}
            x={(i * (bw + gap)).toFixed(1)}
            y={(h - bh).toFixed(1)}
            width={bw.toFixed(1)}
            height={bh.toFixed(1)}
            rx={3}
            fill={i === BAR_DATA.length - 1 ? "#fff" : "rgba(255,255,255,0.42)"}
          />
        );
      })}
    </svg>
  );
}

function MicroRing(props: { size?: number }) {
  const size = props.size ?? 96;
  const sw = 7;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={sw} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#fff" strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={`${c.toFixed(1)} ${c.toFixed(1)}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.2} fontWeight={750} fill="#fff">
        100%
      </text>
      <text x="50%" y="63%" textAnchor="middle" fontSize={size * 0.078} fontWeight={600} fill="rgba(255,255,255,0.75)" letterSpacing="1">
        CHECKS PASSED
      </text>
    </svg>
  );
}

function GlassFunnel() {
  const max = Math.max(...FUNNEL_ROWS.map(([, v]) => v));
  return (
    <div className="grid w-full gap-2">
      {FUNNEL_ROWS.map(([label, v], i) => (
        <div key={label} className="grid grid-cols-[52px_1fr_18px] items-center gap-2">
          <span className="text-[9px] font-semibold text-white/80">{label}</span>
          <span className="block h-2.5 overflow-hidden rounded-full bg-white/25">
            <span
              className="block h-full rounded-full bg-white"
              style={{ width: `${Math.max(9, (v / max) * 100)}%`, opacity: 1 - i * 0.26 }}
            />
          </span>
          <span className="text-right text-[10px] font-bold tabular-nums text-white">{v}</span>
        </div>
      ))}
    </div>
  );
}

function GlassChecklist() {
  return (
    <div className="grid w-full gap-1.5">
      {LIST_ROWS.map((text, i) => (
        <div key={text} className="flex items-center gap-2 rounded-xl bg-white/15 px-2.5 py-2 ring-1 ring-white/20">
          <svg width={13} height={13} viewBox="0 0 13 13" aria-hidden>
            <circle cx={6.5} cy={6.5} r={5.6} fill={i === 0 ? "#fff" : "none"} stroke={i === 0 ? "#fff" : "rgba(255,255,255,0.6)"} strokeWidth={1.4} />
            {i === 0 && <path d="M4 6.7l1.8 1.8 3.2-3.6" fill="none" stroke="#0e0f12" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
          <span className={cn("text-[10px] font-semibold leading-tight", i === 0 ? "text-white" : "text-white/75")}>{text}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Square briefing card: 75% image area + 25% text strip               */
/* ------------------------------------------------------------------ */

const CARD_SIZE = 216;
const TEXT_STRIP = 54;

function CardTextStrip(props: { card: BriefingCard, index: number }) {
  return (
    <div className="flex h-[54px] shrink-0 items-center justify-between gap-2 bg-[#1b1b20] px-3">
      <div className="min-w-0">
        <div className="truncate text-[8px] font-bold uppercase tracking-[0.14em]" style={{ color: props.card.accent }}>
          {props.card.eyebrow}
        </div>
        <div className="truncate text-[11px] font-semibold text-white">{props.card.title}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {CARDS.map((_, dot) => (
          <span
            key={dot}
            className={cn("h-1 rounded-full", dot === props.index ? "w-3 bg-white" : "w-1 bg-white/30")}
          />
        ))}
      </div>
    </div>
  );
}

function SquareCard(props: { card: BriefingCard, index: number }) {
  const { card, index } = props;
  const image = (
    <div className="relative min-h-0 flex-1" style={{ background: card.wash }}>
      {card.hero && (
        <div className="absolute left-3 top-3">
          <div className="text-[26px] font-extrabold leading-none tracking-tight text-white tabular-nums">{card.hero.value}</div>
          <div className="mt-1 text-[8.5px] font-semibold uppercase tracking-wider text-white/75">{card.hero.label}</div>
        </div>
      )}
      {card.viz === "spark" && (
        <div className="absolute inset-x-3 bottom-2"><MicroSpark id={`spark-${index}`} /></div>
      )}
      {card.viz === "bars" && (
        <div className="absolute inset-x-3 bottom-2"><MicroBars /></div>
      )}
      {card.viz === "ring" && (
        <div className="absolute inset-0 flex items-center justify-center"><MicroRing /></div>
      )}
      {card.viz === "funnel" && (
        <div className="absolute inset-x-3 bottom-3"><GlassFunnel /></div>
      )}
      {card.viz === "list" && (
        <div className="absolute inset-x-3 top-1/2 -translate-y-1/2"><GlassChecklist /></div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-xl ring-1 ring-white/10" style={{ width: CARD_SIZE, height: CARD_SIZE }}>
      {card.textFirst ? (
        <>
          <CardTextStrip card={card} index={index} />
          {image}
        </>
      ) : (
        <>
          {image}
          <CardTextStrip card={card} index={index} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Apple-style card stack (deal one by one, then collapse into a pile) */
/* ------------------------------------------------------------------ */

const STACK_GAP = 8;
const STACK_TOP_PAD = 18;
const DEPTH_TRANSFORMS = [
  "rotate(0deg) translate(0px, 0px) scale(1)",
  "rotate(-5deg) translate(-10px, -6px) scale(0.96)",
  "rotate(4deg) translate(10px, -10px) scale(0.92)",
  "rotate(-2deg) translate(-4px, -13px) scale(0.9)",
  "rotate(2deg) translate(4px, -14px) scale(0.88)",
];

function CardStack(props: { onProgress: () => void }) {
  const [dealtCount, setDealtCount] = useState(0);
  const [stacked, setStacked] = useState(false);
  const [frontIndex, setFrontIndex] = useState(0);
  const onProgressRef = useRef(props.onProgress);
  onProgressRef.current = props.onProgress;
  const visibleCardNumber = frontIndex + 1;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= CARDS.length; i++) {
      timers.push(setTimeout(() => {
        setDealtCount(i);
        onProgressRef.current();
      }, i * 420));
    }
    timers.push(setTimeout(() => {
      setStacked(true);
      onProgressRef.current();
    }, CARDS.length * 420 + 800));
    return () => timers.forEach(clearTimeout);
  }, []);

  const height = stacked
    ? CARD_SIZE + STACK_TOP_PAD + 8
    : Math.max(1, dealtCount) * (CARD_SIZE + STACK_GAP) - STACK_GAP + 8;

  return (
    <button
      type="button"
      aria-label={`Cycle through briefing cards, showing card ${visibleCardNumber} of ${CARDS.length}`}
      onClick={() => stacked && setFrontIndex((f) => (f + 1) % CARDS.length)}
      className={cn("relative block text-left transition-[height] duration-500", stacked ? "cursor-pointer" : "cursor-default")}
      style={{ width: CARD_SIZE, height }}
    >
      {CARDS.map((card, i) => {
        const dealt = i < dealtCount;
        const depth = (i - frontIndex + CARDS.length) % CARDS.length;
        return (
          <div
            key={card.eyebrow}
            className="absolute left-0 transition-all duration-500"
            style={stacked ? {
              top: STACK_TOP_PAD,
              transform: DEPTH_TRANSFORMS[Math.min(depth, DEPTH_TRANSFORMS.length - 1)],
              zIndex: CARDS.length - depth,
              opacity: depth > 2 ? 0 : 1,
            } : {
              top: i * (CARD_SIZE + STACK_GAP),
              zIndex: i,
              opacity: dealt ? 1 : 0,
            }}
          >
            {dealt && (
              <div className="demo-message-in">
                <SquareCard card={card} index={i} />
              </div>
            )}
          </div>
        );
      })}
      {stacked && (
        <div className="demo-message-in absolute right-0 top-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#3a3a40] px-1.5 text-[11px] font-semibold text-white shadow-md ring-1 ring-white/15">
          {visibleCardNumber}
        </div>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Conversation script                                                 */
/* ------------------------------------------------------------------ */

type Step =
  | { from: "hexclave", kind: "text", text: string, delay: number }
  | { from: "hexclave", kind: "cards", delay: number }
  | { from: "hexclave", kind: "email", delay: number }
  | { from: "hexclave", kind: "automation", delay: number }
  | { from: "me", kind: "text", text: string, delay: number };

const STEPS: Step[] = [
  { from: "hexclave", kind: "text", text: `Good morning ☀️ Here’s today’s briefing for ${PROJECT_NAME}.`, delay: 900 },
  { from: "hexclave", kind: "cards", delay: 700 },
  { from: "me", kind: "text", text: "send an email apologising to users for inconvience caused because aws was down.", delay: 4600 },
  { from: "hexclave", kind: "text", text: "On it — drafting an apology for the AWS outage now 📝", delay: 1400 },
  { from: "hexclave", kind: "email", delay: 1800 },
  { from: "hexclave", kind: "text", text: "Sent ✅ Delivered to 1,284 affected users. I’ll flag any replies that need a human.", delay: 1700 },
  { from: "me", kind: "text", text: "send this email everyday at 10am est to all users", delay: 3400 },
  { from: "hexclave", kind: "text", text: "Done ✅ automation set up — every user gets this email each morning.", delay: 1600 },
  { from: "hexclave", kind: "automation", delay: 1500 },
];

function EmailPreviewBubble() {
  return (
    <div className="w-[14.5rem] overflow-hidden rounded-2xl bg-[#26262b] text-left shadow-lg ring-1 ring-white/10">
      <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-2">
        <EnvelopeSimpleIcon className="h-3.5 w-3.5 text-sky-400" weight="duotone" />
        <span className="text-[10px] font-semibold text-white/90">Email · all affected users</span>
      </div>
      <div className="space-y-1.5 px-3 py-2.5">
        <div className="text-[11px] font-semibold leading-snug text-white">
          We’re sorry — yesterday’s AWS outage affected your service
        </div>
        <p className="text-[10px] leading-4 text-white/60">
          Hi there — earlier today an AWS outage caused sign-ins to fail for some users. Everything is back to normal, and no data was lost. We’re sorry for the inconvenience...
        </p>
      </div>
      <div className="flex items-center gap-1.5 border-t border-white/10 px-3 py-2">
        <CheckCircleIcon className="h-3.5 w-3.5 text-emerald-400" weight="fill" />
        <span className="text-[10px] font-medium text-emerald-400">Sent to 1,284 recipients</span>
      </div>
    </div>
  );
}

function AutomationBubble() {
  return (
    <div className="w-[14.5rem] overflow-hidden rounded-2xl bg-[#26262b] text-left shadow-lg ring-1 ring-white/10">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.04] px-3 py-2">
        <div className="flex items-center gap-2">
          <ClockIcon className="h-3.5 w-3.5 text-violet-400" weight="duotone" />
          <span className="text-[10px] font-semibold text-white/90">Automation · daily email</span>
        </div>
        <div className="flex h-3.5 w-6 items-center rounded-full bg-emerald-500 p-[2px]">
          <div className="ml-auto h-2.5 w-2.5 rounded-full bg-white shadow-sm" />
        </div>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        <div className="text-[11px] font-semibold leading-snug text-white">
          Service status update
        </div>
        <div className="flex items-center gap-1.5">
          <ClockIcon className="h-3 w-3 text-white/40" />
          <span className="text-[10px] text-white/60">Every day · 10:00 AM ET</span>
        </div>
        <div className="flex items-center gap-1.5">
          <UsersThreeIcon className="h-3 w-3 text-white/40" />
          <span className="text-[10px] text-white/60">All users · 1,284 recipients</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 border-t border-white/10 px-3 py-2">
        <CheckCircleIcon className="h-3.5 w-3.5 text-emerald-400" weight="fill" />
        <span className="text-[10px] font-medium text-emerald-400">Active · next run tomorrow 10:00 AM</span>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex w-fit items-center gap-1 rounded-3xl rounded-bl-md bg-[#26262b] px-4 py-3">
      {[0, 1, 2].map((dot) => (
        <div
          key={dot}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/50"
          style={{ animationDelay: `${dot * 150}ms`, animationDuration: "900ms" }}
        />
      ))}
    </div>
  );
}

function MessageRow(props: { step: Step, onProgress: () => void }) {
  const isMe = props.step.from === "me";
  return (
    <div className={cn("flex demo-message-in", isMe ? "justify-end" : "justify-start")}>
      {props.step.kind === "text" ? (
        <div
          className={cn(
            "max-w-[15rem] rounded-3xl px-3.5 py-2 text-[13px] leading-[1.3rem]",
            isMe
              ? "rounded-br-md bg-gradient-to-b from-[#3d8bff] to-[#0a5fef] text-white"
              : "rounded-bl-md bg-[#26262b] text-white"
          )}
        >
          {props.step.text}
        </div>
      ) : props.step.kind === "cards" ? (
        <CardStack onProgress={props.onProgress} />
      ) : props.step.kind === "automation" ? (
        <AutomationBubble />
      ) : (
        <EmailPreviewBubble />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* iPhone frame                                                        */
/* ------------------------------------------------------------------ */

function PhoneDemo(props: { replayKey: number }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    setVisibleCount(0);
    setIsTyping(false);
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;

    const showStep = (index: number) => {
      if (cancelled || index >= STEPS.length) return;
      const step = STEPS[index];
      const typingDuration = step.from === "hexclave" ? Math.min(step.delay, 900) : 0;

      timeout = setTimeout(() => {
        if (cancelled) return;
        if (typingDuration > 0) setIsTyping(true);
        timeout = setTimeout(() => {
          if (cancelled) return;
          setIsTyping(false);
          setVisibleCount(index + 1);
          showStep(index + 1);
        }, typingDuration);
      }, step.delay - typingDuration);
    };

    showStep(0);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [props.replayKey]);

  useEffect(() => {
    scrollToBottom();
  }, [visibleCount, isTyping, scrollToBottom]);

  const delivered = visibleCount >= STEPS.length;

  return (
    <div className="relative h-[46rem] w-[22.5rem] rounded-[3.4rem] bg-[#1a1a1e] p-[0.6rem] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9),inset_0_0_0_2px_#3a3a40]">
      <div className="absolute -left-[3px] top-28 h-8 w-[3px] rounded-l bg-[#3a3a40]" />
      <div className="absolute -left-[3px] top-40 h-14 w-[3px] rounded-l bg-[#3a3a40]" />
      <div className="absolute -right-[3px] top-36 h-20 w-[3px] rounded-r bg-[#3a3a40]" />

      <div className="relative flex h-full flex-col overflow-hidden rounded-[2.9rem] bg-black">
        <div className="absolute left-1/2 top-2.5 z-30 h-[1.85rem] w-[7.5rem] -translate-x-1/2 rounded-full bg-black ring-1 ring-white/[0.06]" />

        <div className="z-20 flex items-center justify-between px-9 pb-1 pt-4 text-[13px] font-semibold text-white">
          <span>9:41</span>
          <div className="flex items-center gap-1.5">
            <div className="flex items-end gap-[2px]">
              {[4, 6, 8, 10].map((h) => (
                <div key={h} className="w-[3px] rounded-sm bg-white" style={{ height: h }} />
              ))}
            </div>
            <svg viewBox="0 0 16 12" className="h-3 w-4 fill-white">
              <path d="M8 9.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM8 5c1.9 0 3.6.7 4.9 1.9l-1.4 1.5A5 5 0 008 7a5 5 0 00-3.5 1.4L3.1 6.9A7 7 0 018 5zm0-5c3.3 0 6.3 1.3 8.5 3.4l-1.4 1.4A10 10 0 008 2 10 10 0 00.9 4.8L-.5 3.4A12 12 0 018 0z" transform="translate(0.5,0)" />
            </svg>
            <div className="flex items-center gap-[2px]">
              <div className="flex h-3 w-6 items-center rounded-[4px] border border-white/60 p-[2px]">
                <div className="h-full w-4/5 rounded-[2px] bg-white" />
              </div>
              <div className="h-1 w-[2px] rounded-r bg-white/60" />
            </div>
          </div>
        </div>

        <div className="z-20 flex flex-col items-center border-b border-white/10 bg-black/70 pb-2 pt-1 backdrop-blur-xl">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-700 text-sm font-bold text-white shadow-md">
            H
          </div>
          <div className="mt-1 flex items-center gap-0.5 text-[11px] text-white">
            hexclave
            <svg viewBox="0 0 8 12" className="h-2.5 w-2 fill-white/40">
              <path d="M1.5 0L8 6l-6.5 6L0 10.5 4.9 6 0 1.5z" />
            </svg>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3.5 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="pb-1 pt-2 text-center text-[10px] font-medium text-white/40">
            Today 9:41 AM
          </div>
          {STEPS.slice(0, visibleCount).map((step, index) => (
            <MessageRow key={`${props.replayKey}-${index}`} step={step} onProgress={scrollToBottom} />
          ))}
          {isTyping && (
            <div className="demo-message-in flex justify-start">
              <TypingIndicator />
            </div>
          )}
          {delivered && (
            <div className="demo-message-in pr-1 text-right text-[10px] font-medium text-white/40">
              Delivered
            </div>
          )}
        </div>

        <div className="z-20 flex items-center gap-2 border-t border-white/10 bg-black/70 px-3 pb-6 pt-2 backdrop-blur-xl">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#26262b] text-lg leading-none text-white/60">
            +
          </div>
          <div className="flex h-8 flex-1 items-center justify-between rounded-full border border-white/15 px-3">
            <span className="text-[13px] text-white/35">iMessage</span>
            <PaperPlaneTiltIcon className="h-4 w-4 text-white/25" weight="fill" />
          </div>
        </div>

        <div className="absolute bottom-1.5 left-1/2 z-30 h-1 w-32 -translate-x-1/2 rounded-full bg-white/80" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function DemoPage() {
  const [replayKey, setReplayKey] = useState(0);

  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top,#1c2333,#090a0f_65%)]">
      <style>{`
        @keyframes demo-message-in {
          from { opacity: 0; transform: translateY(14px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .demo-message-in { animation: demo-message-in 320ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both; }
      `}</style>

      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6">
        <PhoneDemo replayKey={replayKey} />
        <button
          type="button"
          onClick={() => setReplayKey((key) => key + 1)}
          className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-medium text-white/70 transition-colors duration-150 hover:bg-white/[0.12] hover:text-white hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <ArrowCounterClockwiseIcon className="h-3.5 w-3.5" />
          Replay demo
        </button>
      </div>
    </div>
  );
}
