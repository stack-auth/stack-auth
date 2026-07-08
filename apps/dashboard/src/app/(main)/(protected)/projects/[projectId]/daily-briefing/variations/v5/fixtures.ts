// Variation 5 ("CINEMA") — colocated fixtures.
// Everything deterministic: derived from BRIEFING_NOW_MS + makeRng at module
// scope. No Math.random()/Date.now() at render time.

import { BRIEFING_DAY_MS, BRIEFING_NOW_MS, makeRng, seededDailySeries } from "../../mock-data";

// ─── Scene 3: revenue chart w/ anomaly + forecast ─────────────────────────────

export type RevenuePoint = {
  dayMs: number,
  actual: number | null,
  forecast: number | null,
  band: [number, number] | null,
  isAnomaly: boolean,
};

const HISTORY_DAYS = 21;
const FORECAST_DAYS = 7;
export const ANOMALY_OFFSET_DAYS = 4; // days before "now"

export const REVENUE_SERIES: RevenuePoint[] = (() => {
  const history = seededDailySeries({ seed: 501, days: HISTORY_DAYS, base: 1_520_000, drift: 14_000, noise: 0.05 });
  const anomalyIndex = HISTORY_DAYS - 1 - ANOMALY_OFFSET_DAYS;
  const rows: RevenuePoint[] = history.map((p, i) => ({
    dayMs: p.dayMs,
    // The anomaly: a +38% spike, later traced to the Acme Corp upgrade.
    actual: i === anomalyIndex ? Math.round(p.value * 1.38) : p.value,
    forecast: null,
    band: null,
    isAnomaly: i === anomalyIndex,
  }));
  // Forecast fans out from the last actual point.
  const last = rows[rows.length - 1].actual ?? 0;
  const rng = makeRng(502);
  let f = last;
  rows[rows.length - 1] = { ...rows[rows.length - 1], forecast: last, band: [last, last] };
  for (let i = 1; i <= FORECAST_DAYS; i++) {
    f = Math.round(f * (1 + 0.012 + (rng() - 0.5) * 0.01));
    const spread = Math.round(f * 0.055 * Math.sqrt(i));
    rows.push({
      dayMs: BRIEFING_NOW_MS + i * BRIEFING_DAY_MS,
      actual: null,
      forecast: f,
      band: [f - spread, f + spread],
      isAnomaly: false,
    });
  }
  return rows;
})();

export const ANOMALY_POINT = REVENUE_SERIES.find((r) => r.isAnomaly) ?? REVENUE_SERIES[0];

export const ANOMALY_CALLOUT = {
  title: "Traced to Acme Corp upgrade",
  detail: "Enterprise plan, 3-year term, paid annually up front. Confirmed against invoice #4790.",
  amountCents: 412_000,
};

// ─── Scene 4: notable signups + churn autopsy ─────────────────────────────────

export type NotableSignup = {
  id: string,
  name: string,
  email: string,
  company: string,
  city: string,
  plan: string,
  blurb: string, // AI blurb per company
};

export const NOTABLE_SIGNUPS: NotableSignup[] = [
  {
    id: "s1",
    name: "Kai Lindenberg",
    email: "kai@lindenlabs.io",
    company: "Linden Labs",
    city: "Berlin",
    plan: "Team trial",
    blurb: "Series B robotics lab, 140 engineers. Their CTO starred your SDK repo twice this month — warm lead.",
  },
  {
    id: "s2",
    name: "Ana Vetta",
    email: "ana@vetta.dev",
    company: "Vetta",
    city: "São Paulo",
    plan: "Pro",
    blurb: "Fintech infra startup. Signed up 11 minutes after your LatAm pricing page went live — pricing landed.",
  },
  {
    id: "s3",
    name: "Riku Tanaka",
    email: "riku@paperfold.jp",
    company: "Paperfold",
    city: "Tokyo",
    plan: "Team trial",
    blurb: "Design-tool unicorn. Invited 6 teammates in the first hour — fastest team activation this quarter.",
  },
  {
    id: "s4",
    name: "Jo Reyes",
    email: "jo@heliostat.energy",
    company: "Heliostat",
    city: "Austin",
    plan: "Free",
    blurb: "Climate-tech, fresh out of YC. Hit the API rate limit on day one — usage pattern screams upgrade.",
  },
];

export type ChurnedUser = {
  id: string,
  name: string,
  company: string,
  mrrCents: number,
  reason: string,
  winBack: string,
};

export const CHURNED_USERS: ChurnedUser[] = [
  {
    id: "c1",
    name: "Priya Sharma",
    company: "Quantify",
    mrrCents: 49_900,
    reason: "Hit the 3-seat limit, saw the upgrade price, left. Replay shows 40s on the pricing modal.",
    winBack: "Offer legacy pricing for 6 months",
  },
  {
    id: "c2",
    name: "Tom Okafor",
    company: "Brightline",
    mrrCents: 19_900,
    reason: "SSO setup failed twice against their Okta tenant. Support ticket auto-closed before reply.",
    winBack: "White-glove SSO setup call",
  },
  {
    id: "c3",
    name: "Elsa Marino",
    company: "Ferrous",
    mrrCents: 9_900,
    reason: "Usage fell to zero 3 weeks ago. Their project shipped; the account simply expired with it.",
    winBack: "Pause plan instead of cancel",
  },
];

// ─── Scene 4b: replays worth watching (the "dailies") ────────────────────────

export type ReplayDaily = {
  id: string,
  title: string,
  duration: string,
  tag: string,
  tagTone: "hot" | "warm" | "info",
  note: string,
  // Sparkline of activity intensity for the fake filmstrip screen.
  strip: number[],
};

const replayRng = makeRng(504);
const makeStrip = () => Array.from({ length: 14 }, () => 0.25 + replayRng() * 0.75);

export const REPLAY_DAILIES: ReplayDaily[] = [
  {
    id: "r1",
    title: "Checkout flow, abandoned at card entry",
    duration: "4m 12s",
    tag: "RAGE CLICKS",
    tagTone: "hot",
    note: "7 rapid clicks on a disabled Pay button — validation error never rendered.",
    strip: makeStrip(),
  },
  {
    id: "r2",
    title: "Settings → billing loop",
    duration: "2m 48s",
    tag: "DEAD END",
    tagTone: "warm",
    note: "User bounced between two pages 5 times looking for invoices.",
    strip: makeStrip(),
  },
  {
    id: "r3",
    title: "Fastest activation ever recorded",
    duration: "1m 03s",
    tag: "HIGHLIGHT",
    tagTone: "info",
    note: "Paperfold's Riku: signup → first API call in 63 seconds.",
    strip: makeStrip(),
  },
];

// ─── Scene 5: the incident ────────────────────────────────────────────────────

export const INCIDENT = {
  title: "p95 latency spike — /api/v1/sessions",
  startedLabel: "02:41",
  resolvedLabel: "03:12",
  durationLabel: "31m",
  summary: "Connection pool exhaustion after the nightly billing sync. Retries drained the queue and the pool recovered on its own.",
  resolution: "resolved itself 03:12",
};

export type WaterfallRow = {
  id: string,
  label: string,
  startMs: number, // offset within incident window
  durationMs: number,
  tone: "warn" | "hot" | "ok",
};

export const INCIDENT_WATERFALL: WaterfallRow[] = [
  { id: "w1", label: "billing.sync nightly job", startMs: 0, durationMs: 380_000, tone: "warn" },
  { id: "w2", label: "pg pool saturated (98/100)", startMs: 220_000, durationMs: 540_000, tone: "hot" },
  { id: "w3", label: "p95 breaches 1.8s SLO", startMs: 430_000, durationMs: 760_000, tone: "hot" },
  { id: "w4", label: "webhook retries backing off", startMs: 600_000, durationMs: 520_000, tone: "warn" },
  { id: "w5", label: "queue drained, pool releases", startMs: 1_240_000, durationMs: 350_000, tone: "ok" },
  { id: "w6", label: "p95 back under 300ms", startMs: 1_610_000, durationMs: 250_000, tone: "ok" },
];

export const INCIDENT_WINDOW_MS = 1_860_000;

// Heartbeat polyline for the p95 spike (normalized 0..1 y values, spike mid-way).
export const HEARTBEAT_POINTS: number[] = (() => {
  const rng = makeRng(505);
  const pts: number[] = [];
  for (let i = 0; i < 48; i++) {
    const t = i / 47;
    let y = 0.16 + (rng() - 0.5) * 0.05;
    if (t > 0.34 && t < 0.62) {
      const peak = 1 - Math.abs((t - 0.48) / 0.14);
      y += Math.max(0, peak) * 0.74 * (0.75 + rng() * 0.25);
    }
    pts.push(Math.min(1, Math.max(0.05, y)));
  }
  return pts;
})();

// ─── Scene 6: the inbox ──────────────────────────────────────────────────────

export const FIRE_TICKET = {
  id: "TK-2231",
  from: "meredith@rocketry.com",
  company: "Rocketry (Team plan, $499/mo)",
  subject: "Production auth is failing for 20% of our users",
  ageLabel: "42m old",
  body: "Since about 6am UTC roughly a fifth of our login attempts return a 401 even with valid credentials. This is hitting production. We need eyes on this now.",
  suggestedReply: "Hi Meredith — we found it. A stale JWKS cache on two edge nodes was rejecting fresh tokens after your key rotation at 05:58 UTC. We flushed the cache at 07:10; error rate is back to 0% and we're adding rotation-aware invalidation today. Full postmortem by Friday.",
  confidence: "94% match with incident telemetry",
};

export type DraftedEmail = {
  id: string,
  to: string,
  subject: string,
  preview: string,
  reason: string,
};

export const DRAFTED_EMAILS: DraftedEmail[] = [
  {
    id: "e1",
    to: "kai@lindenlabs.io",
    subject: "Welcome aboard — your team workspace is ready",
    preview: "Kai — noticed Linden Labs spun up 3 environments on day one. Here's the 5-minute path to SSO so the rest of your team...",
    reason: "New high-intent signup",
  },
  {
    id: "e2",
    to: "priya@quantify.io",
    subject: "We heard you on pricing",
    preview: "Priya — we're holding your data for 30 days. If the 3-seat jump was the blocker, I can offer the legacy tier through...",
    reason: "Churn win-back",
  },
  {
    id: "e3",
    to: "meredith@rocketry.com",
    subject: "Root cause + fix for this morning's 401s",
    preview: "Meredith — full picture inside: stale JWKS cache on two edge nodes, flushed at 07:10 UTC, invalidation fix shipping...",
    reason: "Incident follow-up",
  },
];

// ─── Scene 7: the watchtower ─────────────────────────────────────────────────

export const SECURITY = {
  secretScan: { label: "Secret scan", status: "clear", detail: "0 leaked keys across 214 repos & 1,082 commits" },
  cveCount: 2,
  cveDetail: "2 low-severity CVEs in transitive deps — patches queued for tonight's deploy",
  mfaPct: 81,
  mfaNudge: "12 admins still on password-only. One click drafts the MFA nudge.",
  anomalousLogins: 0,
};

export type LoginPoint = {
  id: string,
  city: string,
  // Percent coordinates on the stylized dot-grid world.
  x: number,
  y: number,
  countLabel: string,
};

export const LOGIN_POINTS: LoginPoint[] = [
  { id: "l1", city: "Berlin", x: 52, y: 30, countLabel: "38 logins" },
  { id: "l2", city: "São Paulo", x: 33, y: 68, countLabel: "21 logins" },
  { id: "l3", city: "Tokyo", x: 85, y: 38, countLabel: "44 logins" },
  { id: "l4", city: "Austin", x: 22, y: 42, countLabel: "57 logins" },
  { id: "l5", city: "Lagos", x: 48, y: 56, countLabel: "9 logins" },
];

// ─── Scene 8: the plan + finale + credits ────────────────────────────────────

export type SalesPlay = {
  id: string,
  title: string,
  detail: string,
  valueLabel: string,
};

export const SALES_PLAYS: SalesPlay[] = [
  {
    id: "p1",
    title: "Call Linden Labs before Friday",
    detail: "Trial ends in 4 days, 140-engineer org, CTO already engaged. Warmest enterprise lead in the pipeline.",
    valueLabel: "~$24k ARR",
  },
  {
    id: "p2",
    title: "Upgrade nudge for Heliostat",
    detail: "Hit rate limits twice in 24h on the free tier. A usage-based upgrade email converts 31% of accounts like this.",
    valueLabel: "~$3.6k ARR",
  },
  {
    id: "p3",
    title: "Win back Quantify with legacy pricing",
    detail: "Churned over the 3-seat cliff. Draft already written; approval is one click. Data retained for 30 more days.",
    valueLabel: "~$6k ARR",
  },
];

export const BENCHMARK = {
  label: "Weekly revenue growth vs. similar-stage SaaS",
  yourPct: 87, // percentile
  peers: [
    { id: "b1", label: "Median peer", pct: 50 },
    { id: "b2", label: "Top quartile", pct: 75 },
    { id: "b3", label: "Acme Cloud", pct: 87 },
  ],
  note: "Faster than 87% of comparable companies this week.",
};

export type PulseItem = {
  id: string,
  who: string,
  what: string,
  mood: "up" | "flat" | "down",
};

export const TEAM_PULSE: PulseItem[] = [
  { id: "tp1", who: "Eng", what: "14 PRs merged, incident postmortem drafted before standup", mood: "up" },
  { id: "tp2", who: "Support", what: "First-response time down to 11m (was 26m)", mood: "up" },
  { id: "tp3", who: "Sales", what: "2 demos booked, 1 rescheduled — pipeline steady", mood: "flat" },
  { id: "tp4", who: "Design", what: "Checkout redesign in review; fixes the rage-click button", mood: "up" },
];

export const ONE_THING = {
  kicker: "One thing to fix today",
  title: "The disabled Pay button",
  detail: "One silent validation bug produced yesterday's rage clicks, the abandoned checkout, and at least $1.2k in stalled payments. Design's fix is already in review — approve it and everything downstream of it heals.",
  cta: "Review the fix",
};

export type AgentLogEntry = {
  id: string,
  atMs: number,
  action: string,
};

export const AGENT_ACTION_LOG: AgentLogEntry[] = (() => {
  const rng = makeRng(507);
  const actions = [
    "Compiled overnight metrics across 4 regions",
    "Correlated p95 spike with billing.sync job",
    "Verified pool recovery — no paging required",
    "Flushed stale JWKS cache on edge-fra1, edge-fra2",
    "Matched revenue anomaly to invoice #4790",
    "Watched 31 session replays, flagged 3",
    "Tagged rage-click cluster on checkout",
    "Drafted reply to TK-2231 (Rocketry)",
    "Drafted 3 outbound emails, queued for approval",
    "Ran secret scan — 214 repos, all clear",
    "Checked 1,381 dependency versions — 2 low CVEs",
    "Scored 312 signups, surfaced 4 notables",
    "Ran churn autopsy on 3 cancellations",
    "Benchmarked growth vs. 1,204 peer companies",
    "Assembled this briefing in 41 seconds",
  ];
  let t = BRIEFING_NOW_MS - 6.5 * 60 * 60 * 1000; // from ~01:00 UTC
  return actions.map((action, i) => {
    t += (8 + Math.round(rng() * 34)) * 60_000;
    return { id: `a${i}`, atMs: t, action };
  });
})();

export const DELIVERY_MODES = ["Email", "iMessage", "Fax"] as const;
