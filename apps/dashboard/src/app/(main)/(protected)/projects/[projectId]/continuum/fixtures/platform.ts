import type {
  PlatformAnalytics,
  PlatformCron,
  PlatformDomain,
  PlatformEnvVar,
  PlatformFirewallEvent,
  PlatformFunction,
  PlatformRuntimeLog,
  PlatformSpeedInsight,
  PlatformUsage,
} from "./types";

export const RUNTIME_LOGS: PlatformRuntimeLog[] = [
  { id: "rl-1", level: "info", route: "/api/invitations", deployment: "v1.0.47", message: "POST 201 · 42ms", at: "17:41:02" },
  { id: "rl-2", level: "error", route: "/api/invitations", deployment: "v1.0.47", message: "TypeError: Cannot read properties of null (role_id)", at: "17:41:08" },
  { id: "rl-3", level: "warn", route: "/api/invitations", deployment: "v1.0.47", message: "Retrying role lookup for org_atlas", at: "17:41:08" },
  { id: "rl-4", level: "info", route: "/api/auth/session", deployment: "v1.0.46", message: "GET 200 · session resumed after failover", at: "17:42:11" },
  { id: "rl-5", level: "info", route: "/api/teams", deployment: "v1.0.47", message: "GET 200 · 18ms", at: "17:42:14" },
];

export const FUNCTIONS: PlatformFunction[] = [
  { id: "fn-1", name: "api/invitations", kind: "serverless", invocations: 42_800, errors: 612, p99Ms: 1_240, coldStarts: 18 },
  { id: "fn-2", name: "api/auth/session", kind: "edge", invocations: 210_000, errors: 2, p99Ms: 48, coldStarts: 0 },
  { id: "fn-3", name: "middleware", kind: "middleware", invocations: 890_000, errors: 0, p99Ms: 12, coldStarts: 0 },
  { id: "fn-4", name: "api/webhooks/stripe", kind: "serverless", invocations: 8_400, errors: 0, p99Ms: 320, coldStarts: 4 },
];

export const CRON_JOBS: PlatformCron[] = [
  { id: "cron-1", name: "purge-expired-invites", schedule: "0 */6 * * *", lastStatus: "ok", lastRunAt: "2026-07-10T12:00:00.000Z" },
  { id: "cron-2", name: "compat-window-sweeper", schedule: "*/5 * * * *", lastStatus: "ok", lastRunAt: "2026-07-10T17:40:00.000Z" },
  { id: "cron-3", name: "usage-rollup", schedule: "0 0 * * *", lastStatus: "ok", lastRunAt: "2026-07-10T00:00:00.000Z" },
];

export const DOMAINS: PlatformDomain[] = [
  {
    id: "dom-1",
    hostname: "app.acme.com",
    ssl: "active",
    dns: [
      { type: "CNAME", name: "app", value: "cname.hexclave.app" },
      { type: "TXT", name: "_hexclave", value: "hc-verify=…" },
    ],
  },
  {
    id: "dom-2",
    hostname: "feat-pricing--acme.hexclave.app",
    ssl: "active",
    dns: [{ type: "CNAME", name: "feat-pricing--acme", value: "preview.hexclave.app" }],
  },
];

export const ENV_VARS: PlatformEnvVar[] = [
  { id: "ev-1", key: "DATABASE_URL", environments: ["dev", "preview", "prod"], encrypted: true },
  { id: "ev-2", key: "HEXCLAVE_SECRET_SERVER_KEY", environments: ["dev", "preview", "prod"], encrypted: true },
  { id: "ev-3", key: "FEATURE_CUSTOM_ROLES", environments: ["preview", "prod"], encrypted: false, branchOverride: "feat-pricing" },
  { id: "ev-4", key: "STRIPE_WEBHOOK_SECRET", environments: ["prod"], encrypted: true },
];

export const FIREWALL_EVENTS: PlatformFirewallEvent[] = [
  { id: "fw-1", kind: "challenge", count: 1_240, country: "US" },
  { id: "fw-2", kind: "bot", count: 8_420, country: "CN" },
  { id: "fw-3", kind: "blocked", count: 312, country: "RU" },
];

export const WEB_ANALYTICS: PlatformAnalytics = {
  visitors: 48_200,
  pageViews: 182_400,
  topReferrers: [
    { source: "Direct", views: 62_000 },
    { source: "docs.acme.com", views: 28_400 },
    { source: "google", views: 21_200 },
  ],
  topCountries: [
    { country: "United States", views: 98_000 },
    { country: "Germany", views: 18_400 },
    { country: "United Kingdom", views: 14_200 },
  ],
};

export const SPEED_INSIGHTS: PlatformSpeedInsight[] = [
  { route: "/", lcp: 1.2, cls: 0.02, inp: 48, score: "good" },
  { route: "/settings/roles", lcp: 2.8, cls: 0.08, inp: 160, score: "needs-improvement" },
  { route: "/invitations", lcp: 3.4, cls: 0.12, inp: 280, score: "poor" },
];

export const USAGE_SPEND: PlatformUsage = {
  bandwidthGb: 1_840,
  functionInvocations: 12_400_000,
  buildMinutes: 420,
  projectedBillUsd: 1_280,
  spendCapUsd: 2_500,
};

export const STORAGE_CARDS = [
  { id: "kv", title: "KV", subtitle: "Edge key-value · 12 namespaces", metric: "4.2M reads/day" },
  { id: "blob", title: "Blob", subtitle: "Object storage · 840 GB", metric: "1.1M requests/day" },
  { id: "edge-config", title: "Edge Config", subtitle: "Feature flags + config", metric: "Tied to rollout stages" },
] as const;
