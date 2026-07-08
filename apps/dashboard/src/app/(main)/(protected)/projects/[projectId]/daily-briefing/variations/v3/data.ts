// Fixtures for Variation 3 — "TERMINAL". Everything deterministic: module-scope
// seeded PRNG only, no Date.now()/Math.random() at render time.

import { BRIEFING_DAY_MS, BRIEFING_NOW_MS, makeRng, seededDailySeries } from "../../mock-data";

export type Severity = "OK" | "WARN" | "CRIT";

// ─── [01] Overnight agent log ─────────────────────────────────────────────────

export type AgentLogLine = {
  id: string,
  ts: string, // fixed Z timestamps — the agent worked overnight
  text: string,
  level: Severity,
};

export const AGENT_LOG: AgentLogLine[] = [
  { id: "l1", ts: "23:41Z", text: "nightly digest compiled — 4,917 sessions scanned", level: "OK" },
  { id: "l2", ts: "00:07Z", text: "retried 3 failed billing webhooks — all delivered", level: "OK" },
  { id: "l3", ts: "01:22Z", text: "latency drift on eu-west auth callbacks (+220ms)", level: "WARN" },
  { id: "l4", ts: "02:58Z", text: "INCIDENT #4271 opened — token refresh error spike", level: "CRIT" },
  { id: "l5", ts: "03:12Z", text: "INCIDENT #4271 resolved — stale JWKS cache purged", level: "OK" },
  { id: "l6", ts: "04:30Z", text: "secret scan sweep across 214 repos — 0 findings", level: "OK" },
  { id: "l7", ts: "05:15Z", text: "drafted 3 outbound emails from churn + signup signals", level: "OK" },
  { id: "l8", ts: "06:47Z", text: "benchmarked project vs 2,140 peers — 4 metrics ranked", level: "OK" },
];

// ─── [03] Revenue + signups ───────────────────────────────────────────────────

export const REVENUE_HISTORY = seededDailySeries({ seed: 3101, days: 21, base: 1_520_000, drift: 14_000, noise: 0.05 });

// Anomaly: pin a visible dip 5 days back so the [ANOMALY] tag has a target.
export const ANOMALY_INDEX = REVENUE_HISTORY.length - 6;
REVENUE_HISTORY[ANOMALY_INDEX] = {
  ...REVENUE_HISTORY[ANOMALY_INDEX],
  value: Math.round(REVENUE_HISTORY[ANOMALY_INDEX].value * 0.72),
};

export type RevenuePoint = {
  dayMs: number,
  actual: number | null,
  forecast: number | null,
};

export const REVENUE_SERIES: RevenuePoint[] = (() => {
  const rng = makeRng(3102);
  const points: RevenuePoint[] = REVENUE_HISTORY.map((p) => ({ dayMs: p.dayMs, actual: p.value, forecast: null }));
  const last = REVENUE_HISTORY[REVENUE_HISTORY.length - 1];
  points[points.length - 1].forecast = last.value; // stitch the dotted line to the solid one
  let v = last.value;
  for (let i = 1; i <= 7; i++) {
    v = v + 16_000 + (rng() - 0.35) * 40_000;
    points.push({ dayMs: last.dayMs + i * BRIEFING_DAY_MS, actual: null, forecast: Math.round(v) });
  }
  return points;
})();

export const SIGNUP_HISTO = seededDailySeries({ seed: 3103, days: 14, base: 268, drift: 4, noise: 0.14 });

// ─── [04] Notable signups ─────────────────────────────────────────────────────

export type NotableSignup = {
  id: string,
  who: string,
  org: string,
  plan: string,
  blurb: string, // AI blurb
};

export const NOTABLE_SIGNUPS: NotableSignup[] = [
  { id: "s1", who: "kai@lindenlabs.io", org: "LINDEN LABS", plan: "TEAM", blurb: "Series B devtools co; invited 6 teammates in first hour — expansion candidate." },
  { id: "s2", who: "ana@vetta.dev", org: "VETTA", plan: "PRO", blurb: "Fintech in São Paulo; hit the SSO docs 4x — likely enterprise auth need." },
  { id: "s3", who: "riku@paperfold.jp", org: "PAPERFOLD", plan: "FREE", blurb: "Shipped a working integration in 22 min — fastest activation this week." },
  { id: "s4", who: "jo@heliostat.energy", org: "HELIOSTAT", plan: "TEAM", blurb: "Climate-tech; came from the Convex adapter blog post, imported 1.2k users." },
];

// ─── [05] Churn autopsy ───────────────────────────────────────────────────────

export type ChurnRow = {
  id: string,
  org: string,
  mrrCents: number,
  reason: string,
  share: number, // 0..1 weight for the reason bar
};

export const CHURN_ROWS: ChurnRow[] = [
  { id: "c1", org: "NORTHWIND", mrrCents: 49_900, reason: "hit M2M token rate limits, silence after ticket #8812", share: 0.42 },
  { id: "c2", org: "BLUEPEAK", mrrCents: 29_900, reason: "champion left the company (LinkedIn signal)", share: 0.31 },
  { id: "c3", org: "QUARTZ.IO", mrrCents: 9_900, reason: "only used magic links — moved to in-house", share: 0.27 },
];

export const CHURN_TOTAL_CENTS = CHURN_ROWS.reduce((a, r) => a + r.mrrCents, 0);

// ─── [06] Support digest ──────────────────────────────────────────────────────

export type SupportTheme = { id: string, theme: string, count: number, delta: number };

export const SUPPORT_THEMES: SupportTheme[] = [
  { id: "th1", theme: "OAuth redirect mismatch", count: 11, delta: +6 },
  { id: "th2", theme: "Billing proration confusion", count: 7, delta: +2 },
  { id: "th3", theme: "Passkey on Safari 18", count: 5, delta: -1 },
  { id: "th4", theme: "Webhook signature docs", count: 3, delta: 0 },
];

export const FIRE_TICKET = {
  id: "#9124",
  from: "cto@rocketry.dev",
  plan: "TEAM · $499/mo",
  age: "38m",
  text: "Prod login is failing for ~10% of our users since your 02:58Z incident. Need confirmation this is fully resolved or we roll back.",
  suggestedReply:
    "Hi — the 02:58Z token-refresh incident was fully resolved at 03:12Z (stale JWKS cache purged, error rate back to baseline for 4h+). Your failures after 03:12Z would be client-side cached tokens; a forced refresh clears them. Happy to hop on a call — no rollback needed.",
};

// ─── [07] Replays worth watching ──────────────────────────────────────────────

export type ReplayRow = {
  id: string,
  route: string,
  duration: string,
  rageClicks: number,
  note: string,
};

export const REPLAYS: ReplayRow[] = [
  { id: "r1", route: "/settings/billing", duration: "4m 12s", rageClicks: 9, note: "user hammered a disabled SAVE after editing VAT id" },
  { id: "r2", route: "/checkout", duration: "2m 40s", rageClicks: 5, note: "coupon field rejects uppercase codes, retried 5x" },
  { id: "r3", route: "/auth/mfa", duration: "1m 03s", rageClicks: 3, note: "QR never rendered on Firefox — CSP blocked the data URI" },
];

// ─── [08] Security report ─────────────────────────────────────────────────────

export type LoginRow = {
  id: string,
  who: string,
  coords: string,
  place: string,
  device: string,
  level: Severity,
};

export const UNUSUAL_LOGINS: LoginRow[] = [
  { id: "g1", who: "sam@acme.dev", coords: "52.5200N 13.4050E", place: "BERLIN, DE", device: "known device", level: "OK" },
  { id: "g2", who: "priya@acme.dev", coords: "1.3521N 103.8198E", place: "SINGAPORE, SG", device: "new device · travel likely", level: "WARN" },
  { id: "g3", who: "ci-bot@acme.dev", coords: "39.0438N 77.4874W", place: "ASHBURN, US", device: "datacenter IP · expected", level: "OK" },
];

export const MFA_COVERAGE = { enrolled: 21, total: 26 };

export type CveRow = { id: string, pkg: string, sev: Severity, note: string };

export const CVES: CveRow[] = [
  { id: "cve1", pkg: "jsonwebtoken@9.0.1", sev: "WARN", note: "CVE-2026-1180 — patch in 9.0.3, no exploit path in our usage" },
  { id: "cve2", pkg: "fastify@4.28.0", sev: "OK", note: "CVE-2026-0442 — mitigated by config, upgrade queued" },
];

// ─── [09] Sales plays ─────────────────────────────────────────────────────────

export type SalesPlay = {
  rank: number,
  org: string,
  play: string,
  whyNow: string,
  valueCents: number,
};

export const SALES_PLAYS: SalesPlay[] = [
  { rank: 1, org: "LINDEN LABS", play: "Upgrade TEAM → ENTERPRISE", whyNow: "6 seats in 1h + SSO docs opened twice", valueCents: 2_400_000 },
  { rank: 2, org: "VETTA", play: "Offer SAML pilot", whyNow: "4 visits to enterprise auth docs in 24h", valueCents: 1_200_000 },
  { rank: 3, org: "ROCKETRY", play: "Incident follow-up call", whyNow: "just upgraded, then got burned at 02:58Z", valueCents: 600_000 },
  { rank: 4, org: "HELIOSTAT", play: "Migration white-glove", whyNow: "imported 1.2k users on day one", valueCents: 480_000 },
];

// ─── [10] Drafted emails / outbox ─────────────────────────────────────────────

export type DraftEmail = {
  id: string,
  to: string,
  subject: string,
  preview: string,
};

export const DRAFT_EMAILS: DraftEmail[] = [
  { id: "e1", to: "cto@rocketry.dev", subject: "Last night's incident — what happened + your account", preview: "Full timeline, root cause, and a credit for the trouble…" },
  { id: "e2", to: "kai@lindenlabs.io", subject: "Welcome — noticed your team moved fast", preview: "Six teammates on day one is rare. Here's the SSO fast path…" },
  { id: "e3", to: "ops@northwind.com", subject: "Before you go — rate limits are fixable", preview: "Saw ticket #8812 stalled. M2M limits are configurable on your plan…" },
];

// ─── [11] Incident waterfall ──────────────────────────────────────────────────

export type IncidentSpan = {
  id: string,
  name: string,
  startMs: number, // offset from incident start
  durMs: number,
  level: Severity,
};

export const INCIDENT = {
  id: "#4271",
  title: "TOKEN REFRESH ERROR SPIKE",
  openedAt: "02:58Z",
  resolvedAt: "03:12Z",
  durationLabel: "14m 06s",
  rootCause: "stale JWKS cache after key rotation — self-healed on purge",
  spans: [
    { id: "sp1", name: "error-rate alarm fired", startMs: 0, durMs: 42_000, level: "CRIT" },
    { id: "sp2", name: "agent: correlate spans", startMs: 42_000, durMs: 118_000, level: "WARN" },
    { id: "sp3", name: "agent: bisect deploys", startMs: 160_000, durMs: 205_000, level: "WARN" },
    { id: "sp4", name: "root cause: jwks cache", startMs: 365_000, durMs: 90_000, level: "WARN" },
    { id: "sp5", name: "cache purge + rollout", startMs: 455_000, durMs: 240_000, level: "OK" },
    { id: "sp6", name: "verify: error rate 0.02%", startMs: 695_000, durMs: 151_000, level: "OK" },
  ] as IncidentSpan[],
  totalMs: 846_000,
};

// ─── [12] Team pulse (audit tail) ─────────────────────────────────────────────

export type PulseLine = { id: string, who: string, action: string, ts: string };

export const TEAM_PULSE: PulseLine[] = [
  { id: "p1", who: "sam", action: "changed auth.redirect_urls (+2 domains)", ts: "18:42Z" },
  { id: "p2", who: "priya", action: "rotated STRIPE_WEBHOOK_SECRET", ts: "19:15Z" },
  { id: "p3", who: "dev", action: "enabled passkeys for prod project", ts: "21:03Z" },
  { id: "p4", who: "sam", action: "invited lena@acme.dev as admin", ts: "22:36Z" },
  { id: "p5", who: "ci-bot", action: "deployed api@2026.7.7-r2 (green)", ts: "23:58Z" },
];

// ─── [13] Benchmarks (percentiles vs peers) ───────────────────────────────────

export type BenchmarkRow = {
  id: string,
  metric: string,
  valueLabel: string,
  percentile: number, // 0..100, higher = better
};

export const BENCHMARKS: BenchmarkRow[] = [
  { id: "b1", metric: "signup→activation", valueLabel: "38%", percentile: 91 },
  { id: "b2", metric: "auth p95 latency", valueLabel: "142ms", percentile: 78 },
  { id: "b3", metric: "week-4 retention", valueLabel: "64%", percentile: 71 },
  { id: "b4", metric: "MFA adoption", valueLabel: "81%", percentile: 44 },
];

// ─── [14] One thing to fix ────────────────────────────────────────────────────

export const ONE_THING = {
  title: "coupon field rejects uppercase codes at /checkout",
  impact: "5 rage-click replays · est. $3.2k/wk in abandoned upgrades",
  fix: "lowercase the input before validation — one-line change in checkout/coupon.ts",
};

// ─── Command console canned responses ─────────────────────────────────────────

export const CANNED_RESPONSES: string[] = [
  "revenue is pacing +12.4% WoW; forecast holds if today's cohort converts at ≥ 6%.",
  "the 02:58Z incident self-resolved; only ROCKETRY is still visibly annoyed. email #1 handles it.",
  "your riskiest metric is MFA adoption (P44). the WARN row in [08] has the nudge queued.",
  "3 drafts in the outbox. sending all three takes ~4 seconds and probably saves $499 MRR.",
];

// Session clock: the header clock starts from the anchor and ticks in useEffect.
export const SESSION_START_MS = BRIEFING_NOW_MS;
