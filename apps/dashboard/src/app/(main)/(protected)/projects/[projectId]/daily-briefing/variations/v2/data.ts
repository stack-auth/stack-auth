// Fixtures for the BENTO variation. Everything is deterministic: module-scope
// seeded PRNG only, no Date.now()/Math.random() at render time.

import { BRIEFING_DAY_MS, BRIEFING_NOW_MS, makeRng, seededDailySeries } from "../../mock-data";

// ─── Revenue chart: 14 days of history + 4 days dotted forecast + one anomaly ──

export type RevenuePoint = {
  dayMs: number,
  actual: number | null,
  forecast: number | null,
};

const revenueHistory = seededDailySeries({ seed: 2101, days: 14, base: 15600, drift: 240, noise: 0.07 });

export const REVENUE_ANOMALY_INDEX = 9;

export const REVENUE_SERIES: RevenuePoint[] = (() => {
  const rng = makeRng(2102);
  const rows: RevenuePoint[] = revenueHistory.map((p, i) => ({
    dayMs: p.dayMs,
    actual: i === REVENUE_ANOMALY_INDEX ? Math.round(p.value * 1.42) : p.value,
    forecast: null,
  }));
  // Forecast picks up where actuals end (shared joint point keeps lines connected).
  const last = rows[rows.length - 1];
  last.forecast = last.actual;
  let projected = last.actual ?? 0;
  for (let i = 1; i <= 4; i++) {
    projected = Math.round(projected * (1.015 + rng() * 0.012));
    rows.push({ dayMs: BRIEFING_NOW_MS + i * BRIEFING_DAY_MS, actual: null, forecast: projected });
  }
  return rows;
})();

export const REVENUE_ANOMALY = REVENUE_SERIES[REVENUE_ANOMALY_INDEX];

// ─── Sparkline + donut ─────────────────────────────────────────────────────────

export const SIGNUPS_SPARK = seededDailySeries({ seed: 2201, days: 14, base: 240, drift: 5, noise: 0.14 });

export const PLAN_MIX = [
  { name: "Free", value: 6120, color: "#64748b" },
  { name: "Pro", value: 1840, color: "#8b5cf6" },
  { name: "Team", value: 412, color: "#10b981" },
];

// ─── Agent action log ──────────────────────────────────────────────────────────

export const AGENT_ACTIONS = [
  { id: "a1", time: "01:44", text: "Retried 12 failed billing webhooks — all recovered" },
  { id: "a2", time: "02:31", text: "Rotated a leaked test API key found in CI logs" },
  { id: "a3", time: "03:12", text: "Scaled db pool during latency spike, then back down" },
  { id: "a4", time: "05:58", text: "Drafted 3 outreach emails from overnight signups" },
];

// ─── Notable signups w/ AI blurbs ──────────────────────────────────────────────

export const NOTABLE_SIGNUPS = [
  {
    id: "s1",
    name: "Kai Lindström",
    email: "kai@lindenlabs.io",
    company: "Linden Labs",
    blurb: "Series B devtools startup, ~80 engineers. Their CTO starred your SDK repo last week.",
  },
  {
    id: "s2",
    name: "Ana Vetta",
    email: "ana@vetta.dev",
    company: "Vetta",
    blurb: "Brazilian fintech, PCI-heavy. Landed on the SOC 2 page twice before signing up.",
  },
  {
    id: "s3",
    name: "Riku Sato",
    email: "riku@paperfold.jp",
    company: "Paperfold",
    blurb: "Doc-automation YC W26 batch. Invited 4 teammates within 20 minutes of signup.",
  },
];

// ─── Churn autopsy ─────────────────────────────────────────────────────────────

export const CHURN_ROWS = [
  { id: "c1", company: "Northwind Ops", mrr: 34900, reason: "Hit seat limit, chose competitor bundle" },
  { id: "c2", company: "Brightcove Labs", mrr: 12900, reason: "Project shelved after re-org" },
  { id: "c3", company: "Slate & Co", mrr: 4900, reason: "Never activated — 0 API calls in 30 days" },
];

// ─── Support digest ────────────────────────────────────────────────────────────

export const SUPPORT_THEMES = [
  { id: "th1", label: "Webhook retries", count: 14, pct: 100 },
  { id: "th2", label: "SSO config", count: 9, pct: 64 },
  { id: "th3", label: "Invoice PDFs", count: 5, pct: 36 },
];

export const FIRE_TICKET = {
  id: "TCK-4821",
  from: "cto@rocketry.dev",
  text: "Enterprise trial blocked — SAML assertion rejected on their IdP. Renewal call is Friday.",
};

// ─── Replays ───────────────────────────────────────────────────────────────────

export const REPLAYS = [
  { id: "r1", label: "checkout → success", duration: "4m 12s", kind: "smooth" as const },
  { id: "r2", label: "settings/billing", duration: "1m 03s", kind: "rage" as const },
];

// ─── Security ──────────────────────────────────────────────────────────────────

export const LOGIN_DOTS = [
  { id: "l1", x: 22, y: 34, city: "Austin", ok: true },
  { id: "l2", x: 47, y: 26, city: "Berlin", ok: true },
  { id: "l3", x: 55, y: 62, city: "Lagos", ok: false },
  { id: "l4", x: 80, y: 38, city: "Tokyo", ok: true },
  { id: "l5", x: 30, y: 72, city: "São Paulo", ok: true },
];

export const UNUSUAL_LOGIN = "1 unusual login: Lagos, new device — sam@acme.dev (challenged, passed)";

export const SECURITY_POSTURE = [
  { id: "p1", label: "MFA coverage", value: "82%", note: "3 admins still on SMS — nudge drafted", tone: "warn" as const },
  { id: "p2", label: "CVE watch", value: "0 critical", note: "2 moderate in transitive deps, patch PR open", tone: "ok" as const },
];

// ─── Sales plays ───────────────────────────────────────────────────────────────

export const SALES_PLAYS = [
  { id: "sp1", account: "Rocketry", play: "Upsell to Enterprise", why: "Hit 90% of seat cap twice this week" },
  { id: "sp2", account: "Heliostat", play: "Expansion into EU org", why: "Berlin subsidiary signed up separately yesterday" },
  { id: "sp3", account: "Paperfold", play: "Founder-led onboarding call", why: "4 invites in 20 min — activation window is now" },
];

// ─── Drafted emails ────────────────────────────────────────────────────────────

export const DRAFT_EMAILS = [
  { id: "e1", to: "kai@lindenlabs.io", subject: "Your SOC 2 questions, answered", preview: "Saw your team evaluating — here is the short version of our compliance story…" },
  { id: "e2", to: "cto@rocketry.dev", subject: "SAML fix + Friday call prep", preview: "We reproduced the assertion issue on your IdP config. Two-line fix attached…" },
  { id: "e3", to: "ana@vetta.dev", subject: "PCI architecture walkthrough", preview: "A 6-minute Loom of how fintechs isolate cardholder data with us…" },
];

// ─── Incident ──────────────────────────────────────────────────────────────────

export const INCIDENT = {
  title: "Latency spike — api.us-east",
  window: "02:41 → 03:12",
  resolvedAt: "03:12",
  spans: [
    { id: "w1", label: "edge.router", start: 0, width: 18, tone: "ok" as const },
    { id: "w2", label: "api.handler", start: 12, width: 30, tone: "warn" as const },
    { id: "w3", label: "db.pool.wait", start: 26, width: 52, tone: "bad" as const },
    { id: "w4", label: "db.query", start: 74, width: 16, tone: "ok" as const },
  ],
  note: "Pool exhaustion from a webhook retry storm. Auto-scaled, back to baseline.",
};

// ─── Team pulse (audit lines) ──────────────────────────────────────────────────

export const TEAM_PULSE = [
  { id: "tp1", time: "22:14", actor: "sam", action: "rotated prod signing key" },
  { id: "tp2", time: "23:02", actor: "jo", action: "shipped checkout-v2 to 10% of traffic" },
  { id: "tp3", time: "06:45", actor: "riya", action: "approved 2 access requests" },
];

// ─── Benchmark / one thing / delivery ──────────────────────────────────────────

export const BENCHMARK = {
  percentile: 78,
  cohort: "B2B SaaS, 1–10M ARR",
  line: "Your activation rate beats 78% of comparable projects this week.",
};

export const ONE_THING = {
  title: "Fix the billing page rage clicks",
  body: "9 sessions rage-clicked the disabled Save button on settings/billing. One-line fix: enable it when the form is dirty. Estimated recovered upgrades: ~$2.1k/mo.",
};
