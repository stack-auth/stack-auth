// Fixtures for Variation 4 — "BROADSHEET". Everything deterministic:
// derived from the shared anchor + seeded PRNG, never Date.now()/Math.random().

import { BRIEFING_DAY_MS, BRIEFING_NOW_MS, makeRng, seededDailySeries } from "../../mock-data";

// ─── Masthead ─────────────────────────────────────────────────────────────────

export const MASTHEAD = {
  name: "THE ACME LEDGER",
  tagline: "All the signal that's fit to ship",
  edition: "Vol. 1 · No. 189 · Wednesday, July 8, 2026 · Morning Edition · FREE for subscribers",
  price: "PRICE: $0.00 — INCLUDED IN PLAN",
  weather: {
    title: "TODAY'S FORECAST",
    line1: "+8% MRR, scattered anomalies clearing by noon.",
    line2: "Outlook: sunny with a chance of churn. UV index: 3 deploys.",
  },
};

// ─── Lead story: revenue anomaly ──────────────────────────────────────────────

export type RevenuePoint = { dayMs: number, actual: number | null, forecast: number | null };

function buildRevenueSeries(): { points: RevenuePoint[], anomaly: { dayMs: number, value: number } } {
  const raw = seededDailySeries({ seed: 47, days: 30, base: 51000, drift: 260, noise: 0.05 });
  // The anomaly: yesterday's close jumps 12% on the Acme Corp upgrade.
  const last = raw[raw.length - 1];
  const prev = raw[raw.length - 2];
  last.value = Math.round(prev.value * 1.12);

  const points: RevenuePoint[] = raw.map((p) => ({ dayMs: p.dayMs, actual: p.value, forecast: null }));
  // Dotted forecast: 6 days out, seeded wiggle, joined at the last actual point.
  points[points.length - 1].forecast = last.value;
  const rng = makeRng(93);
  let v = last.value;
  for (let i = 1; i <= 6; i++) {
    v = Math.round(v + 380 + (rng() - 0.5) * 900);
    points.push({ dayMs: BRIEFING_NOW_MS + i * BRIEFING_DAY_MS, actual: null, forecast: v });
  }
  return { points, anomaly: { dayMs: last.dayMs, value: last.value } };
}

export const REVENUE_FIGURE = buildRevenueSeries();

export const LEAD_STORY = {
  kicker: "BUSINESS DESK —",
  headline: "REVENUE JUMPS 12% AS ACME CORP UPGRADES",
  deck: "Largest single-day move of the quarter arrives overnight; forecast desks scramble to revise upward",
  dateline: "FRANKFURT, 03:12 —",
  lede:
    "Revenue leapt 12.4% against the trailing average late Tuesday after Acme Corp, a longtime free-tier resident, upgraded forty seats to the Team plan in a single checkout session lasting under three minutes. The anomaly detector flagged the spike at 03:12 and, finding nothing wrong, filed it under good news.",
  body: [
    "Analysts at the billing desk note the upgrade followed a week of unusually heavy API traffic from Acme's staging environment — a pattern the sales wire had already ranked as its number-one play. The invoice cleared on the first attempt.",
    "Forecast models, previously calling for a quiet week, have been revised upward by 8%. The dotted line on the accompanying figure reflects the new consensus; the marked point is the jump itself, confirmed against ledger entries and a session replay of the checkout.",
  ],
  pullQuote: "The largest single-day upgrade this quarter, and nobody had to lift a finger.",
  pullQuoteAttribution: "— THE BILLING DESK, MORNING NOTE",
  continued: "Full ledger tables, page B2 · Continued on page A7",
  figCaption: "FIG. 1 — REVENUE, TRAILING 30 DAYS. DOTTED: REVISED FORECAST. MARKED: THE JUMP, CONFIRMED 03:12.",
};

// ─── Overnight desk (agent actions, corrections-box style) ────────────────────

export type OvernightAction = {
  id: string,
  time: string,
  text: string,
  detail: string,
};

export const OVERNIGHT_ACTIONS: OvernightAction[] = [
  {
    id: "oa1",
    time: "01:07",
    text: "Rotated a publishable key found in a public gist",
    detail: "Old key revoked, new key issued; zero downstream failures observed.",
  },
  {
    id: "oa2",
    time: "02:31",
    text: "Retried 3 failed billing webhooks — all succeeded",
    detail: "billing.sync endpoints recovered after upstream 503s cleared.",
  },
  {
    id: "oa3",
    time: "04:27",
    text: "Throttled a scraper hammering /api/v1/users",
    detail: "412 req/min from one ASN; rate-limited, not banned. Watching.",
  },
  {
    id: "oa4",
    time: "05:44",
    text: "Merged duplicate accounts for kai@lindenlabs.io",
    detail: "OAuth and password accounts unified; sessions preserved.",
  },
];

// ─── Support story + fire ticket ──────────────────────────────────────────────

export const SUPPORT_STORY = {
  kicker: "SUPPORT DESK —",
  headline: "SEVEN TICKETS TRACE OAUTH LOOP",
  dateline: "THE INBOX, 06:40 —",
  lede:
    "Seven tickets filed since Monday describe the same misfortune: Safari users bounced endlessly between /signin and /callback, never arriving anywhere. Investigators traced the loop to last Thursday's cookie policy change, which set SameSite=Strict on the session cookie and stranded the OAuth handoff.",
  body:
    "Six of the seven reporters were polite about it. The seventh is reproduced below, lightly singed. A one-line fix is staged and awaits review.",
};

export const FIRE_TICKET = {
  ticketId: "#4871",
  from: "cto@rocketry.io",
  heading: "LETTERS TO THE EDITOR — URGENT",
  excerpt:
    "Third time this week my team gets stuck in your login carousel. We just paid for 40 seats. If sign-in still spins tomorrow, we are spinning too — right back to our old provider.",
  suggestedReplyLabel: "SUGGESTED REPLY, DRAFTED 06:52",
  suggestedReply:
    "You're right, and it's our fault — a cookie change on our side broke Safari sign-ins. The fix ships today; your seats have been credited one week. I'll confirm personally once it's live.",
};

// ─── Churn obituaries ─────────────────────────────────────────────────────────

export type Obituary = {
  id: string,
  name: string,
  tenure: string,
  notice: string,
  cause: string,
};

export const OBITUARIES: Obituary[] = [
  {
    id: "ob1",
    name: "NIMBUS ANALYTICS",
    tenure: "14 months",
    notice:
      "Departed peacefully after fourteen months of steady usage. Survived by 4 seats, a dormant Slack integration, and 2.1 GB of event data held in loving cold storage.",
    cause: "Series B security review mandated in-house auth.",
  },
  {
    id: "ob2",
    name: "OTTERWORKS",
    tenure: "31 days",
    notice:
      "Slipped away quietly at the end of trial, having never entered a credit card. In lieu of flowers, the family asks that pricing be reconsidered.",
    cause: "Price sensitivity — trial ended, card never added.",
  },
  {
    id: "ob3",
    name: "REDBRICK LABS",
    tenure: "9 months",
    notice:
      "Left suddenly and without a forwarding address. No admin had logged in for 31 days. Friends remember an integration that once ran nightly.",
    cause: "Champion left the company; account went unattended.",
  },
];

// ─── New arrivals (society column) ────────────────────────────────────────────

export type Arrival = {
  id: string,
  name: string,
  origin: string,
  line: string,
};

export const ARRIVALS: Arrival[] = [
  { id: "ar1", name: "LINDENLABS", origin: "Berlin", line: "Agentic CAD tooling; seed-funded and shipping like it's a deadline." },
  { id: "ar2", name: "VETTA.DEV", origin: "São Paulo", line: "Dev-tools studio; visited the pricing page six times this week. Intent noted." },
  { id: "ar3", name: "PAPERFOLD", origin: "Tokyo", line: "Print-on-demand origami kits. Genuinely. The API traffic is immaculate." },
  { id: "ar4", name: "HELIOSTAT", origin: "Austin", line: "Solar fleet telemetry; currently courting the SSO feature behind the velvet rope." },
];

// ─── Security blotter ─────────────────────────────────────────────────────────

export type BlotterEntry = { id: string, time: string, text: string };

export const BLOTTER: BlotterEntry[] = [
  { id: "bl1", time: "06:00", text: "Routine secret scan of 214 repositories concluded. Nothing to report. Residents may sleep soundly." },
  { id: "bl2", time: "02:14", text: "Unusual login attempt for sam@acme.dev from an unfamiliar network. Subject challenged; passed MFA; released without incident." },
  { id: "bl3", time: "05:30", text: "MFA adoption stands at 78%. Twelve administrators remain unprotected. A stern but loving nudge has been drafted (see Classifieds)." },
  { id: "bl4", time: "06:15", text: "Dependency sweep: 0 exploitable CVEs. Three low-severity advisories loitering in transitive dependencies were told to move along." },
];

// ─── Market pages (benchmarks as stock listings) ──────────────────────────────

export type MarketRow = {
  symbol: string,
  name: string,
  last: string,
  change: string,
  up: boolean | null, // null = flat
  percentile: string,
};

export const MARKET_ROWS: MarketRow[] = [
  { symbol: "MRR", name: "Monthly recurring revenue", last: "$55.3K", change: "+12.4", up: true, percentile: "p91" },
  { symbol: "ACTV", name: "Activation rate", last: "41.2%", change: "+1.8", up: true, percentile: "p78" },
  { symbol: "RTN7", name: "7-day retention", last: "64.9%", change: "+0.4", up: true, percentile: "p82" },
  { symbol: "TTFV", name: "Time to first value", last: "3m 40s", change: "-22s", up: true, percentile: "p88" },
  { symbol: "NPS", name: "Net promoter score", last: "58", change: "0.0", up: null, percentile: "p74" },
  { symbol: "CHRN", name: "Monthly logo churn", last: "1.9%", change: "+0.2", up: false, percentile: "p61" },
];

export const NORTH_STARS = [
  { label: "WEEKLY ACTIVE TEAMS", value: "1,204" },
  { label: "API CALLS / DAY", value: "9.4M" },
  { label: "NET REVENUE RETENTION", value: "118%" },
];

// ─── Sports final (incident play-by-play) ─────────────────────────────────────

export type Play = {
  id: string,
  time: string,
  label: string,
  startMin: number, // minutes after 02:41
  durMin: number,
  accent: boolean,
};

export const SPORTS_STORY = {
  kicker: "SPORTS FINAL —",
  headline: "INCIDENT RESOLVED 03:12",
  deck: "Latency spike goes down swinging in 31 minutes; no humans paged",
  recap:
    "A p95 latency spike opened strong at 02:41 but never found its rhythm. Auto-scaling answered within six minutes, the cache rebuilt under pressure, and by 03:12 the scoreboard read all clear. Attendance: zero paged engineers.",
  figCaption: "FIG. 2 — PLAY-BY-PLAY, 02:41–03:12 UTC. SHADED: DEGRADED WINDOW.",
};

export const PLAYS: Play[] = [
  { id: "p1", time: "02:41", label: "p95 latency spike detected (api-eu)", startMin: 0, durMin: 14, accent: true },
  { id: "p2", time: "02:47", label: "Auto-scale: +4 replicas provisioned", startMin: 6, durMin: 6, accent: false },
  { id: "p3", time: "02:55", label: "Cache rebuild, warm-through", startMin: 14, durMin: 17, accent: false },
  { id: "p4", time: "03:12", label: "All clear — error budget intact", startMin: 31, durMin: 2, accent: false },
];

export const PLAY_TOTAL_MIN = 33;

// ─── The rundown (sales plays) ────────────────────────────────────────────────

export type SalesPlay = {
  rank: number,
  title: string,
  whyNow: string,
  score: number,
};

export const SALES_PLAYS: SalesPlay[] = [
  {
    rank: 1,
    title: "Call Rocketry while the upgrade is warm",
    whyNow: "40 seats purchased at 03:09; champion active in-app right now. Expansion propensity 92/100.",
    score: 92,
  },
  {
    rank: 2,
    title: "Vetta.dev keeps circling the pricing page",
    whyNow: "Six visits in five days, two from the founder's account. A nudge email is typeset in the Classifieds.",
    score: 81,
  },
  {
    rank: 3,
    title: "Heliostat is trialing SSO the hard way",
    whyNow: "Three failed SAML config attempts yesterday. Offer the white-glove setup before frustration wins.",
    score: 74,
  },
];

// ─── Classifieds (drafted emails) ─────────────────────────────────────────────

export type ClassifiedAd = {
  id: string,
  category: string,
  to: string,
  subject: string,
  body: string,
};

export const CLASSIFIEDS: ClassifiedAd[] = [
  {
    id: "cl1",
    category: "CONGRATULATIONS",
    to: "cfo@rocketry.io",
    subject: "Welcome to the Team tier",
    body: "Forty seats, three minutes, zero friction — a pleasure doing business. Shall we schedule a 20-minute onboarding for the new folks this week?",
  },
  {
    id: "cl2",
    category: "PUBLIC NOTICES",
    to: "12 administrators",
    subject: "Turn on MFA (we timed it: 2 minutes)",
    body: "You are one of twelve admins without MFA. The other 44 speak highly of it. Two minutes now spares us all a very long incident later.",
  },
  {
    id: "cl3",
    category: "PERSONALS",
    to: "ana@vetta.dev",
    subject: "Saw you eyeing the pricing page",
    body: "Six visits and no hello? If the Team tier is the hesitation, here's a founder code for 20% off the first quarter. No pressure — the page will keep.",
  },
];

// ─── Editorial (one thing to fix today) ───────────────────────────────────────

export const EDITORIAL = {
  heading: "THE EDITORIAL BOARD",
  title: "ONE THING TO FIX TODAY: THE SAFARI SIGN-IN LOOP",
  body:
    "This paper rarely editorializes, but seven tickets, one furious CTO, and a fix that is quite literally one line make the case themselves. Review the staged patch, ship it before lunch, and let tomorrow's edition carry the correction notice instead of the complaint. Everything else on this page can wait a day. This cannot.",
  sign: "— THE EDITORIAL BOARD, IN FULL AGREEMENT FOR ONCE",
};

// ─── Staff movements (team pulse) ─────────────────────────────────────────────

export const STAFF_MOVEMENTS = [
  { id: "st1", text: "S. CHEN shipped 14 commits to auth-service Tuesday — a personal best, verified by the records desk." },
  { id: "st2", text: "M. OKAFOR closed 9 tickets, extending a three-day streak. Support desk morale reported 'suspiciously high.'" },
  { id: "st3", text: "NEW BYLINE — J. PARK joins the platform desk Monday. Colleagues are asked to hide the legacy cron jobs until Wednesday." },
  { id: "st4", text: "R. ALVAREZ departs on leave through Friday. Escalations route to on-call, which has been informed and has accepted its fate." },
];

// ─── Small print ──────────────────────────────────────────────────────────────

export const DELIVERY_NOTICE =
  "BRIEFING DELIVERED DAILY BY EMAIL, IMESSAGE & FACSIMILE — ENQUIRE WITHIN · SUBSCRIPTIONS INCLUDED WITH ALL PLANS · SUBMIT CORRECTIONS TO THE OVERNIGHT DESK";

export const INDEX_LINE =
  "INDEX — BUSINESS A1 · OVERNIGHT A2 · SUPPORT A3 · OBITUARIES A4 · SOCIETY A5 · BLOTTER A6 · MARKETS B1 · SPORTS C1 · CLASSIFIEDS D1 · OPINION D2";

// Deterministic barcode bars for the price corner.
export const BARCODE_BARS: number[] = (() => {
  const rng = makeRng(7);
  return Array.from({ length: 26 }, () => 1 + Math.floor(rng() * 3));
})();
