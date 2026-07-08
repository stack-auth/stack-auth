// Shared mock-data foundation for the Daily Briefing prototype.
//
// Hydration rule: this page is SSR'd, so nothing here may read the real clock
// or real randomness at render time. Everything derives from a fixed anchor
// and a seeded PRNG evaluated at module scope, so server and client always
// compute identical values. Components that want a live wall clock must start
// it from useEffect with a fixture fallback.
//
// Section-specific fixtures live next to their widget files; this module only
// holds the anchor, the PRNG, formatters, and the fixtures shared across the
// page (hero stats, ticker, personas).

export const BRIEFING_NOW_MS = Date.UTC(2026, 6, 8, 7, 30); // Wed Jul 8 2026, 07:30 UTC
export const BRIEFING_DAY_MS = 24 * 60 * 60 * 1000;

// Deterministic PRNG (mulberry32). Call makeRng(seed) per fixture family so
// adding a fixture never shifts the values of an unrelated one.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generates a smooth-ish daily series ending at BRIEFING_NOW_MS.
export function seededDailySeries(options: {
  seed: number,
  days: number,
  base: number,
  drift?: number,
  noise?: number,
}): { dayMs: number, value: number }[] {
  const { seed, days, base, drift = 0, noise = 0.12 } = options;
  const rng = makeRng(seed);
  const out: { dayMs: number, value: number }[] = [];
  let value = base;
  for (let i = days - 1; i >= 0; i--) {
    value = Math.max(0, value + drift + (rng() - 0.5) * 2 * noise * base);
    out.push({ dayMs: BRIEFING_NOW_MS - i * BRIEFING_DAY_MS, value: Math.round(value) });
  }
  return out;
}

// ─── Formatters (fixed locale/timezone so SSR and client agree) ───────────────

export function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function fmtCompact(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function fmtTime(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(ms));
}

export function fmtDay(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

export function fmtShortDay(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

// "2m ago" style, relative to BRIEFING_NOW_MS.
export function fmtAgo(ms: number): string {
  const diff = Math.max(0, BRIEFING_NOW_MS - ms);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── The mock project persona ─────────────────────────────────────────────────

export const MOCK_VIEWER = {
  firstName: "Mantra",
  projectName: "Acme Cloud",
};

// AI headline for the cold open + header description.
export const MOCK_HEADLINE =
  "Activation is climbing, last night's latency spike recovered at 03:12 but the root cause is still open, seven tickets point at the same webhook doc, and 3 replies are drafted for your review.";

// Confidence-tagged claims: every AI statement on the page can carry evidence.
export type EvidenceSource = {
  kind: "replay" | "ticket" | "span" | "metric" | "email" | "audit",
  label: string,
};

export type AiClaim = {
  text: string,
  confidence: "high" | "medium" | "low",
  sources: EvidenceSource[],
};

// ─── Hero stats (intro countup montage + header strip) ────────────────────────

export type HeroStat = {
  id: string,
  label: string,
  value: number,
  format: "usd" | "number" | "percent",
  deltaPct: number, // vs yesterday — the briefing thinks in deltas
};

export const HERO_STATS: HeroStat[] = [
  { id: "sessions", label: "Active users", value: 4917, format: "number", deltaPct: +3.6 },
  { id: "signups", label: "New signups", value: 312, format: "number", deltaPct: +8.1 },
  { id: "activation", label: "Activation rate", value: 38, format: "percent", deltaPct: +2.1 },
  { id: "tickets", label: "Tickets resolved", value: 23, format: "number", deltaPct: +21.0 },
  { id: "revenue", label: "Revenue yesterday", value: 1842700, format: "usd", deltaPct: +12.4 },
];

export function formatHeroStat(stat: HeroStat): string {
  if (stat.format === "usd") return fmtUsd(stat.value);
  if (stat.format === "percent") return `${stat.value}%`;
  return fmtNum(stat.value);
}

// ─── Live ticker (fake streaming events strip) ────────────────────────────────

export type TickerEvent = {
  id: string,
  text: string,
  kind: "signup" | "revenue" | "replay" | "security" | "system",
};

export const TICKER_EVENTS: TickerEvent[] = [
  { id: "t1", kind: "signup", text: "New signup from Berlin — kai@lindenlabs.io" },
  { id: "t2", kind: "revenue", text: "Rocketry upgraded to Team ($499/mo)" },
  { id: "t3", kind: "replay", text: "Session replay captured — checkout flow, 4m 12s" },
  { id: "t4", kind: "signup", text: "New signup from São Paulo — ana@vetta.dev" },
  { id: "t5", kind: "system", text: "Webhook retry succeeded — billing.sync" },
  { id: "t6", kind: "security", text: "New login from a known device — sam@acme.dev" },
  { id: "t7", kind: "signup", text: "New signup from Tokyo — riku@paperfold.jp" },
  { id: "t8", kind: "revenue", text: "Invoice #4821 paid — $1,240.00" },
  { id: "t9", kind: "replay", text: "Rage clicks detected — settings/billing" },
  { id: "t10", kind: "signup", text: "New signup from Austin — jo@heliostat.energy" },
];

// ─── Catch-up mode ────────────────────────────────────────────────────────────
// The anchor date is a Wednesday, so catch-up is off by default; the intro can
// still demo it via a toggle. When on, the cold open covers multiple days and
// leads with what resolved itself while you were away.

export const CATCH_UP = {
  daysCovered: 3,
  headline:
    "While you were out: 2 incidents happened Saturday — both auto-resolved. Signups grew all weekend. Nothing needs backfilling.",
  autoResolvedCount: 2,
};
