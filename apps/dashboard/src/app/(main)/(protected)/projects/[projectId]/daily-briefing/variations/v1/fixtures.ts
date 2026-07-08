// Fixtures for Variation 1 ("Editorial"). Everything is deterministic:
// derived from BRIEFING_NOW_MS and module-scope seeded PRNGs only.

import { BRIEFING_DAY_MS, BRIEFING_NOW_MS, seededDailySeries } from "../../mock-data";

const MIN = 60_000;
const HOUR = 60 * MIN;

// ─── 01 · While you slept ─────────────────────────────────────────────────────

export type AgentAction = {
  id: string,
  atMs: number,
  kind: "webhook" | "email" | "anomaly" | "housekeeping",
  title: string,
  detail: string,
  undoable: boolean,
};

// Suggestions only — the briefing never executes anything itself. Each row is
// a prepared action waiting for a human go-ahead.
export const AGENT_ACTIONS: AgentAction[] = [
  {
    id: "act-webhooks",
    atMs: BRIEFING_NOW_MS - 5 * HOUR - 18 * MIN, // 02:12
    kind: "webhook",
    title: "14 webhooks failed overnight — retry the batch?",
    detail: "billing.sync returned 503 for 9 minutes around 02:10. A one-click batch retry is prepared; nothing has been re-sent yet.",
    undoable: false,
  },
  {
    id: "act-replies",
    atMs: BRIEFING_NOW_MS - 4 * HOUR - 44 * MIN, // 02:46
    kind: "email",
    title: "3 support replies drafted for your review",
    detail: "Tickets #4471, #4476, #4480 match 12 previously resolved threads. The drafts sit unsent in chapter 07 until you approve them.",
    undoable: true,
  },
  {
    id: "act-anomaly",
    atMs: BRIEFING_NOW_MS - 4 * HOUR - 6 * MIN, // 03:24
    kind: "anomaly",
    title: "The docs page behind 9 tickets — pin a fix?",
    detail: "Every webhook-signature ticket traces to one stale code sample in the v2 docs. A corrected snippet is staged as a docs PR for your sign-off.",
    undoable: true,
  },
  {
    id: "act-keys",
    atMs: BRIEFING_NOW_MS - 2 * HOUR - 51 * MIN, // 04:39
    kind: "housekeeping",
    title: "2 API keys unused for 90+ days — rotate them?",
    detail: "Both fall under your key-hygiene policy. A rotation plan with a grace period until Friday is ready — keys stay untouched until you approve.",
    undoable: true,
  },
];

// ─── 02 · Metrics ─────────────────────────────────────────────────────────────

export type RevenuePoint = {
  dayMs: number,
  actual: number | null,
  projected: number | null,
  band: [number, number] | null,
};

const RAW_REVENUE = seededDailySeries({ seed: 411, days: 30, base: 15400, drift: 95, noise: 0.06 });

// Index of the anomaly day (Acme Corp upgrade) — 6 days before "today".
export const ANOMALY_INDEX = RAW_REVENUE.length - 7;

const shaped = RAW_REVENUE.map((p, i) => ({
  dayMs: p.dayMs,
  value: i === ANOMALY_INDEX ? Math.round(p.value * 1.42) : p.value,
}));

export const ANOMALY_POINT = { dayMs: shaped[ANOMALY_INDEX].dayMs, value: shaped[ANOMALY_INDEX].value };

// 7-day dotted projection with a widening confidence band.
const LAST = shaped[shaped.length - 1];
const DAILY_SLOPE = (LAST.value - shaped[Math.max(0, shaped.length - 8)].value) / 7;

export const REVENUE_SERIES: RevenuePoint[] = [
  ...shaped.map((p, i) => ({
    dayMs: p.dayMs,
    actual: p.value,
    projected: i === shaped.length - 1 ? p.value : null, // stitch projection to last actual
    band: i === shaped.length - 1 ? ([p.value, p.value] as [number, number]) : null,
  })),
  ...Array.from({ length: 7 }, (_, i) => {
    const step = i + 1;
    const mid = Math.round(LAST.value + DAILY_SLOPE * step * 0.9);
    const spread = Math.round(LAST.value * 0.035 * step);
    return {
      dayMs: LAST.dayMs + step * BRIEFING_DAY_MS,
      actual: null,
      projected: mid,
      band: [mid - spread, mid + spread] as [number, number],
    };
  }),
];

export type NotableSignup = {
  id: string,
  company: string,
  contact: string,
  monogram: string,
  blurb: string,
};

export const NOTABLE_SIGNUPS: NotableSignup[] = [
  {
    id: "su-lindenlabs",
    company: "Linden Labs",
    contact: "kai@lindenlabs.io",
    monogram: "LL",
    blurb: "Berlin dev-tools startup, 40 engineers, just raised a Series A — evaluating you against a homegrown auth stack.",
  },
  {
    id: "su-vetta",
    company: "Vetta",
    contact: "ana@vetta.dev",
    monogram: "VE",
    blurb: "São Paulo fintech; signed up with a work email and invited 4 teammates within the first hour.",
  },
  {
    id: "su-paperfold",
    company: "Paperfold",
    contact: "riku@paperfold.jp",
    monogram: "PF",
    blurb: "Tokyo design-tool studio; landed from your SOC 2 blog post and went straight to the pricing page.",
  },
  {
    id: "su-heliostat",
    company: "Heliostat Energy",
    contact: "jo@heliostat.energy",
    monogram: "HE",
    blurb: "Austin climate-tech, 200+ seats potential; already wired up SSO in the sandbox overnight.",
  },
];

export type ChurnedUser = {
  id: string,
  name: string,
  company: string,
  plan: string,
  // Funnel: percentage completing each step in their final week.
  funnel: { label: string, pct: number }[],
  reason: string,
};

export const CHURNED_USERS: ChurnedUser[] = [
  {
    id: "ch-nordwind",
    name: "Petra Ohlsson",
    company: "Nordwind",
    plan: "Team · $499/mo",
    funnel: [
      { label: "Signed in", pct: 100 },
      { label: "Viewed docs", pct: 72 },
      { label: "Called API", pct: 31 },
      { label: "Invited team", pct: 0 },
    ],
    reason: "Hit the webhook signature docs 9 times in one session, then activity stopped. Likely lost at integration, not price.",
  },
  {
    id: "ch-brightloop",
    name: "Dev Chandra",
    company: "Brightloop",
    plan: "Pro · $99/mo",
    funnel: [
      { label: "Signed in", pct: 100 },
      { label: "Viewed docs", pct: 88 },
      { label: "Called API", pct: 64 },
      { label: "Invited team", pct: 12 },
    ],
    reason: "Usage dropped the week their own launch slipped — churn email cites budget. A 3-month starter discount likely wins them back.",
  },
  {
    id: "ch-quill",
    name: "Sofia Marino",
    company: "Quill & Co",
    plan: "Pro · $99/mo",
    funnel: [
      { label: "Signed in", pct: 100 },
      { label: "Viewed docs", pct: 41 },
      { label: "Called API", pct: 8 },
      { label: "Invited team", pct: 0 },
    ],
    reason: "Never got past the first API call — session replay shows a CORS error loop on day one that nobody reported.",
  },
];

// ─── 03 · Support digest ──────────────────────────────────────────────────────

export type SupportTheme = {
  id: string,
  theme: string,
  count: number,
  deltaPct: number,
  summary: string,
};

export const SUPPORT_THEMES: SupportTheme[] = [
  {
    id: "th-webhooks",
    theme: "Webhook signature verification",
    count: 9,
    deltaPct: +80,
    summary: "Spiked after Tuesday's SDK release — every ticket is the same stale code sample from the v2 docs.",
  },
  {
    id: "th-sso",
    theme: "SSO domain setup",
    count: 5,
    deltaPct: -17,
    summary: "Steady enterprise-onboarding noise; the new setup wizard is slowly absorbing these.",
  },
  {
    id: "th-billing",
    theme: "Invoice PDF formatting",
    count: 3,
    deltaPct: 0,
    summary: "All three are EU customers asking for reverse-charge VAT lines on invoices.",
  },
];

export const FIRE_TICKET = {
  id: "#4491",
  from: "maya@rocketry.dev",
  company: "Rocketry",
  plan: "Team · upgraded 6 days ago",
  excerpt:
    "This is the third day our users can't log in with Google on mobile Safari. If this isn't fixed by Friday we're moving our launch — and probably our auth — somewhere else.",
  aiNote: "Rocketry is your newest Team upgrade and the anomaly on your revenue chart. Session replays confirm the failure is real: the OAuth popup is blocked on iOS 26 Safari.",
  suggestedReply:
    "Hi Maya — you're right, and I'm sorry it took three days to get this in front of a human. We reproduced the failure: iOS 26 Safari blocks the OAuth popup in standalone web-app mode. A fix (redirect-based fallback) is deploying today; I'll confirm on this thread the moment it's live on your project, and I've credited this month's invoice in the meantime.",
};

// ─── 04 · Replays worth watching ──────────────────────────────────────────────

export type ReplayCard = {
  id: string,
  title: string,
  subtitle: string,
  duration: string,
  rage: boolean,
  // Gradient stops for the fake "screen".
  screenClass: string,
  progressPct: number,
};

export const REPLAY_CARDS: ReplayCard[] = [
  {
    id: "rp-checkout",
    title: "Checkout abandoned at the last step",
    subtitle: "kai@lindenlabs.io · yesterday 22:41",
    duration: "4m 12s",
    rage: false,
    screenClass:
      "bg-[linear-gradient(135deg,rgba(125,211,252,0.35),rgba(196,181,253,0.3)_50%,rgba(253,230,138,0.28))] dark:bg-[linear-gradient(135deg,rgba(14,116,144,0.35),rgba(109,40,217,0.28)_50%,rgba(217,119,6,0.22))]",
    progressPct: 62,
  },
  {
    id: "rp-billing",
    title: "Rage clicks on the billing page",
    subtitle: "petra@nordwind.se · yesterday 18:03",
    duration: "2m 47s",
    rage: true,
    screenClass:
      "bg-[linear-gradient(135deg,rgba(252,165,165,0.35),rgba(253,186,116,0.3)_55%,rgba(196,181,253,0.25))] dark:bg-[linear-gradient(135deg,rgba(153,27,27,0.4),rgba(154,52,18,0.3)_55%,rgba(76,29,149,0.25))]",
    progressPct: 38,
  },
  {
    id: "rp-onboarding",
    title: "A perfect 90-second onboarding",
    subtitle: "jo@heliostat.energy · today 01:19",
    duration: "1m 33s",
    rage: false,
    screenClass:
      "bg-[linear-gradient(135deg,rgba(167,243,208,0.35),rgba(125,211,252,0.3)_55%,rgba(233,213,255,0.28))] dark:bg-[linear-gradient(135deg,rgba(6,95,70,0.4),rgba(14,116,144,0.3)_55%,rgba(109,40,217,0.22))]",
    progressPct: 84,
  },
];

// ─── 05 · Security report ─────────────────────────────────────────────────────

export const SECURITY_REPORT = {
  secretScan: "Secret scan clean — 0 exposed keys across 214 repos, 61 gists, and last night's deploy artifacts.",
  unusualLogins: [
    {
      id: "lg-lagos",
      who: "sam@acme.dev",
      what: "New device in Lagos, Nigeria — passed MFA, session allowed",
      atLabel: "03:47",
    },
    {
      id: "lg-tor",
      who: "ci-bot@acme.dev",
      what: "Login via Tor exit node — blocked by policy, no retry since",
      atLabel: "04:15",
    },
  ],
  mfaNudge: { count: 2, names: "Priya R. and Tom K.", detail: "2 admins still sign in without MFA" },
  cves: { count: 3, detail: "3 low-severity CVEs in transitive deps — none reachable from your handlers, patch PRs opened" },
};

// ─── 06 · Today's play (sales) ────────────────────────────────────────────────

export type SalesPlay = {
  id: string,
  rank: number,
  company: string,
  monogram: string,
  whyNow: string,
  expectedValueCents: number,
  motion: string,
};

export const SALES_PLAYS: SalesPlay[] = [
  {
    id: "sp-heliostat",
    rank: 1,
    company: "Heliostat Energy",
    monogram: "HE",
    whyNow: "Wired up SSO in the sandbox overnight and invited 6 teammates — classic 48-hour buying window.",
    expectedValueCents: 2388000,
    motion: "Offer a 30-minute architecture review today",
  },
  {
    id: "sp-lindenlabs",
    rank: 2,
    company: "Linden Labs",
    monogram: "LL",
    whyNow: "Fresh Series A plus a build-vs-buy evaluation — their CTO starred your migration guide this morning.",
    expectedValueCents: 1188000,
    motion: "Send the homegrown-auth TCO one-pager",
  },
  {
    id: "sp-rocketry",
    rank: 3,
    company: "Rocketry",
    monogram: "RK",
    whyNow: "Newest Team upgrade, currently your one fire ticket — a same-day fix converts anger into a reference call.",
    expectedValueCents: 599000,
    motion: "Pair the fix deploy with a personal call",
  },
];

// ─── 07 · Drafted emails ──────────────────────────────────────────────────────

export type DraftedEmail = {
  id: string,
  kind: "Win-back" | "Upsell" | "Incident apology",
  to: string,
  toName: string,
  subject: string,
  preview: string,
  body: string[],
};

export const DRAFTED_EMAILS: DraftedEmail[] = [
  {
    id: "dr-winback",
    kind: "Win-back",
    to: "sofia@quillandco.com",
    toName: "Sofia Marino",
    subject: "That CORS error was on us — want a working setup by Friday?",
    preview: "We found the day-one CORS loop that blocked your first API call…",
    body: [
      "Hi Sofia,",
      "Going through our session data, we found something embarrassing: your very first API call hit a CORS misconfiguration on our side, looped for 20 minutes, and nobody caught it. That was almost certainly your whole experience of us — and it wasn't representative.",
      "We've fixed the root cause. If you're open to it, I'd like to personally pair with you for 20 minutes this week and get Quill & Co to a working integration — plus three months on us for the false start.",
      "Either way, sorry for the wasted afternoon.",
    ],
  },
  {
    id: "dr-upsell",
    kind: "Upsell",
    to: "ana@vetta.dev",
    toName: "Ana Duarte",
    subject: "Vetta hit 4,800 monthly active users — two weeks ahead of plan",
    preview: "You're at 96% of the Pro tier's MAU ceiling. Before you hit the wall…",
    body: [
      "Hi Ana,",
      "Quick heads-up before it becomes a surprise: Vetta crossed 4,800 monthly active users last night — 96% of the Pro tier ceiling, two weeks ahead of your own growth plan.",
      "Rather than let you hit a hard limit mid-launch, we can move you to Team now and pro-rate the difference. It also unlocks the audit log your compliance team asked about in March.",
      "Want me to just flip it and send the amended invoice?",
    ],
  },
  {
    id: "dr-apology",
    kind: "Incident apology",
    to: "maya@rocketry.dev",
    toName: "Maya Chen",
    subject: "The mobile Safari login failure — found, fixed, deploying today",
    preview: "You were right to be angry. Here is exactly what happened and when…",
    body: [
      "Hi Maya,",
      "You were right to escalate. iOS 26 Safari started blocking our OAuth popup in standalone web-app mode, and for three days our alerting called it user error. It wasn't.",
      "A redirect-based fallback is deploying today. I'll confirm on this thread the moment it's live on Rocketry's project, and this month's invoice is credited in full.",
      "If Friday's launch needs anything from us — load headroom, a war-room Slack channel — say the word.",
    ],
  },
];

// ─── 08 · Incident ────────────────────────────────────────────────────────────

export type IncidentSpan = {
  id: string,
  label: string,
  startPct: number,
  widthPct: number,
  durLabel: string,
  hot: boolean,
};

export const INCIDENT = {
  title: "p95 latency spike on /api/v1/sessions",
  window: "02:31 – 03:12",
  resolvedAt: "03:12",
  peak: "2.4s p95 (baseline 180ms)",
  cause: "A connection-pool leak in the replay ingest worker starved the sessions API of database connections. The pool recycler kicked in at 03:11 and latency recovered in 90 seconds — but the recycler only papered over it. The leak is still in the ingest worker and will recur under load until it's fixed.",
  spans: [
    { id: "isp-edge", label: "edge.request", startPct: 0, widthPct: 96, durLabel: "2,412ms", hot: false },
    { id: "isp-auth", label: "auth.verify_session", startPct: 4, widthPct: 7, durLabel: "162ms", hot: false },
    { id: "isp-pool", label: "db.pool.acquire", startPct: 11, widthPct: 74, durLabel: "1,860ms", hot: true },
    { id: "isp-query", label: "db.query sessions.find", startPct: 85, widthPct: 6, durLabel: "148ms", hot: false },
    { id: "isp-serialize", label: "serialize.response", startPct: 91, widthPct: 3, durLabel: "71ms", hot: false },
    { id: "isp-flush", label: "edge.flush", startPct: 94, widthPct: 2, durLabel: "44ms", hot: false },
  ] as IncidentSpan[],
};

// Automations the briefing proposes based on what it saw overnight. Nothing is
// enabled until the reader opts in.
export type AutomationSuggestion = {
  id: string,
  rule: string,
  rationale: string,
};

export const AUTOMATION_SUGGESTIONS: AutomationSuggestion[] = [
  {
    id: "auto-webhooks",
    rule: "Auto-retry webhook batches when the failure is a 5xx from your endpoint",
    rationale: "Would have handled last night's 14 failures at 02:12 instead of waiting for this briefing.",
  },
  {
    id: "auto-replies",
    rule: "Auto-draft replies when a ticket matches a resolved thread at 90%+ similarity",
    rationale: "All 3 of today's drafts crossed that bar — you'd still approve every send.",
  },
  {
    id: "auto-anomaly",
    rule: "Auto-annotate metric anomalies that trace to a single account event",
    rationale: "Yesterday's +42% spike would have been labeled 'Acme Corp upgrade' the moment it happened.",
  },
];

// ─── 09 · Team pulse ──────────────────────────────────────────────────────────

export const TEAM_PULSE = [
  {
    id: "tp-priya",
    who: "Priya R.",
    what: "tightened the password policy to 12 characters and enabled breach-database checks",
    whenLabel: "yesterday 16:20",
  },
  {
    id: "tp-tom",
    who: "Tom K.",
    what: "shipped the new EU data-residency config to production and archived the staging project",
    whenLabel: "yesterday 19:04",
  },
  {
    id: "tp-sam",
    who: "sam@acme.dev",
    what: "rotated the Stripe webhook secret and re-verified all 6 billing endpoints",
    whenLabel: "today 01:12",
  },
];

// ─── 10 · Benchmarks ──────────────────────────────────────────────────────────

export type Benchmark = {
  id: string,
  metric: string,
  percentile: number,
  line: string,
};

export const BENCHMARKS: Benchmark[] = [
  {
    id: "bm-activation",
    metric: "Activation",
    percentile: 78,
    line: "78th percentile activation among similar-size B2B SaaS on Hexclave",
  },
  {
    id: "bm-ttfc",
    metric: "Time to first API call",
    percentile: 91,
    line: "91st percentile — your median developer ships a first call in 11 minutes",
  },
  {
    id: "bm-churn",
    metric: "Logo retention",
    percentile: 54,
    line: "54th percentile logo retention — the one number holding back the composite",
  },
];

// ─── 11 · One thing ───────────────────────────────────────────────────────────

export const ONE_THING = {
  headline: "Ship the mobile Safari OAuth fallback before noon.",
  reasoning:
    "It closes your only fire ticket, protects the Acme-sized Rocketry upgrade that drove yesterday's revenue spike, and the incident-apology draft in chapter 07 is already written around it. One deploy, three chapters resolved.",
  cta: "Deploy the fallback",
};

// ─── 12 · Delivery footer ─────────────────────────────────────────────────────

export const DELIVERY_CHANNELS = [
  { id: "dl-dashboard", label: "Dashboard", note: "you are here" },
  { id: "dl-email", label: "Email", note: "07:00 daily" },
  { id: "dl-imessage", label: "iMessage", note: "top 3 only" },
  { id: "dl-fax", label: "Fax", note: "yes, really" },
];
