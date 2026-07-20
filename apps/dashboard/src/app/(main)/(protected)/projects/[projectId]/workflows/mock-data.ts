import type { DesignBadgeColor } from "@hexclave/dashboard-ui-components";

// Shared mock data for the Workflows mock-UI variants. Everything here is
// deterministic fake data modeled after the Workflows v1 spec (step
// memoization, per-workflow versions with run pinning, runKey/onConflict,
// pause-on-divergence, lifecycle events). Timestamps are pre-formatted
// strings on purpose: the page renders identically on every load, with no
// Date usage and no hydration drift.

export type RunState = "queued" | "running" | "sleeping" | "paused" | "failed" | "completed" | "canceled";

export const RUN_STATE_LABELS = new Map<RunState, string>([
  ["queued", "Queued"],
  ["running", "Running"],
  ["sleeping", "Sleeping"],
  ["paused", "Paused"],
  ["failed", "Failed"],
  ["completed", "Completed"],
  ["canceled", "Canceled"],
]);

export const RUN_STATE_BADGE_COLORS = new Map<RunState, DesignBadgeColor>([
  ["queued", "cyan"],
  ["running", "blue"],
  ["sleeping", "purple"],
  ["paused", "orange"],
  ["failed", "red"],
  ["completed", "green"],
  // No neutral badge color exists in the design system; canceled reuses cyan
  // and relies on its icon/label to disambiguate from queued.
  ["canceled", "cyan"],
]);

export function getRunStateLabel(state: RunState): string {
  return RUN_STATE_LABELS.get(state) ?? state;
}

export function getRunStateBadgeColor(state: RunState): DesignBadgeColor {
  return RUN_STATE_BADGE_COLORS.get(state) ?? "blue";
}

export type MockTrigger = {
  kind: "platform" | "custom" | "schedule",
  label: string,
};

export type MockWorkflow = {
  id: string,
  displayName: string,
  description: string,
  triggers: MockTrigger[],
  currentVersion: number,
  activeRuns: number,
  sleepingRuns: number,
  pausedRuns: number,
  failed7d: number,
  runVolume14d: number[],
  lastDeploy: { at: string },
};

export const MOCK_WORKFLOWS: MockWorkflow[] = [
  {
    id: "welcome-drip",
    displayName: "Welcome Drip",
    description: "Three-part intro email sequence for new users, with a re-check guard before every send.",
    triggers: [{ kind: "platform", label: "user.created" }],
    currentVersion: 8,
    activeRuns: 12,
    sleepingRuns: 205,
    pausedRuns: 3,
    failed7d: 3,
    runVolume14d: [42, 38, 51, 47, 44, 61, 58, 49, 53, 66, 72, 68, 74, 81],
    lastDeploy: { at: "2h ago" },
  },
  {
    id: "alert-me-on-special-signups",
    displayName: "Special Signup Alerts",
    description: "Pings the team Slack channel and tags the user when a signup comes from a VIP domain.",
    triggers: [{ kind: "platform", label: "user.created" }],
    currentVersion: 2,
    activeRuns: 0,
    sleepingRuns: 0,
    pausedRuns: 0,
    failed7d: 1,
    runVolume14d: [2, 4, 1, 3, 2, 5, 4, 3, 2, 6, 3, 4, 5, 4],
    lastDeploy: { at: "5d ago" },
  },
  {
    id: "trial-expiry-reminder",
    displayName: "Trial Expiry Reminder",
    description: "Sleeps until 3 days before trial end, then nudges the user unless they already upgraded.",
    triggers: [{ kind: "platform", label: "user.created" }],
    currentVersion: 3,
    activeRuns: 2,
    sleepingRuns: 641,
    pausedRuns: 0,
    failed7d: 2,
    runVolume14d: [30, 28, 35, 31, 33, 41, 39, 36, 38, 45, 47, 43, 49, 52],
    lastDeploy: { at: "6d ago" },
  },
  {
    id: "order-fulfillment",
    displayName: "Order Fulfillment",
    description: "Reacts to custom.order.shipped, waits for the carrier window, then emails tracking updates.",
    triggers: [{ kind: "custom", label: "custom.order.shipped" }],
    currentVersion: 5,
    activeRuns: 34,
    sleepingRuns: 87,
    pausedRuns: 0,
    failed7d: 15,
    runVolume14d: [88, 94, 76, 103, 97, 121, 110, 99, 105, 118, 126, 131, 122, 137],
    lastDeploy: { at: "1d ago" },
  },
  {
    id: "team-offboarding",
    displayName: "Team Offboarding",
    description: "Cancellation policy as a workflow: on team.deleted, cancels sibling runs and notifies owners.",
    triggers: [
      { kind: "platform", label: "team.deleted" },
      { kind: "platform", label: "user.deleted" },
    ],
    currentVersion: 2,
    activeRuns: 1,
    sleepingRuns: 0,
    pausedRuns: 0,
    failed7d: 0,
    runVolume14d: [4, 2, 6, 3, 5, 4, 7, 3, 2, 5, 6, 4, 3, 5],
    lastDeploy: { at: "12d ago" },
  },
  {
    id: "weekly-usage-digest",
    displayName: "Weekly Usage Digest",
    description: "Scheduled digest of team activity, sent every Monday morning in the project timezone.",
    triggers: [{ kind: "schedule", label: "0 11 * * 1 · America/Los_Angeles" }],
    currentVersion: 4,
    activeRuns: 0,
    sleepingRuns: 0,
    pausedRuns: 0,
    failed7d: 0,
    runVolume14d: [0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
    lastDeploy: { at: "3d ago" },
  },
  {
    id: "churn-winback",
    displayName: "Churn Winback",
    description: "Two-touch winback sequence after subscription churn, with a discount on the second touch.",
    triggers: [{ kind: "custom", label: "custom.subscription.churned" }],
    currentVersion: 6,
    activeRuns: 3,
    sleepingRuns: 44,
    pausedRuns: 0,
    failed7d: 11,
    runVolume14d: [12, 15, 9, 14, 11, 18, 16, 13, 17, 21, 19, 24, 22, 26],
    lastDeploy: { at: "4h ago" },
  },
];

export function getWorkflowById(workflowId: string): MockWorkflow {
  const workflow = MOCK_WORKFLOWS.find((w) => w.id === workflowId);
  if (workflow == null) {
    throw new Error(`Mock workflow "${workflowId}" does not exist — mock data references must stay consistent`);
  }
  return workflow;
}

export function getInFlightRunCount(workflow: MockWorkflow): number {
  return workflow.activeRuns + workflow.sleepingRuns + workflow.pausedRuns;
}

export function getRuns7d(workflow: MockWorkflow): number {
  return workflow.runVolume14d.slice(-7).reduce((sum, value) => sum + value, 0);
}

export type MockRun = {
  uuid: string,
  runKey: string | null,
  workflowId: string,
  state: RunState,
  version: number,
  trigger: string,
  triggerSummary: string,
  currentStep: string | null,
  startedAt: string,
  nextWakeAt: string | null,
  stepsRecorded: number,
  errorSummary: string | null,
};

export const MOCK_RUNS: MockRun[] = [
  // welcome-drip
  { uuid: "rn_2vq8k1", runKey: "user:usr_8f3kzt", workflowId: "welcome-drip", state: "paused", version: 8, trigger: "user.created", triggerSummary: "mira@acme.dev", currentStep: "send-intro-email", startedAt: "3d ago", nextWakeAt: null, stepsRecorded: 3, errorSummary: "Divergence: v8 requests unknown step send-intro-email-v2" },
  { uuid: "rn_9mc4xp", runKey: "user:usr_p2n8ww", workflowId: "welcome-drip", state: "paused", version: 8, trigger: "user.created", triggerSummary: "jordan@birch.io", currentStep: "send-intro-email", startedAt: "3d ago", nextWakeAt: null, stepsRecorded: 3, errorSummary: "Divergence: v8 requests unknown step send-intro-email-v2" },
  { uuid: "rn_t7d3ha", runKey: "user:usr_ke01rs", workflowId: "welcome-drip", state: "paused", version: 8, trigger: "user.created", triggerSummary: "sam@lumen.app", currentStep: "send-intro-email", startedAt: "4d ago", nextWakeAt: null, stepsRecorded: 3, errorSummary: "Divergence: v8 requests unknown step send-intro-email-v2" },
  { uuid: "rn_5jw2pn", runKey: "user:usr_v4t9qq", workflowId: "welcome-drip", state: "sleeping", version: 7, trigger: "user.created", triggerSummary: "ada@nordwind.co", currentStep: "wait-1-day", startedAt: "16h ago", nextWakeAt: "in 8h", stepsRecorded: 1, errorSummary: null },
  { uuid: "rn_bb61sc", runKey: "user:usr_m3h7dd", workflowId: "welcome-drip", state: "sleeping", version: 7, trigger: "user.created", triggerSummary: "leo@packet.dev", currentStep: "wait-1-day", startedAt: "9h ago", nextWakeAt: "in 15h", stepsRecorded: 1, errorSummary: null },
  { uuid: "rn_xq04fe", runKey: "user:usr_zc55tn", workflowId: "welcome-drip", state: "running", version: 8, trigger: "user.created", triggerSummary: "noor@stellar.so", currentStep: "recheck-user", startedAt: "2m ago", nextWakeAt: null, stepsRecorded: 1, errorSummary: null },
  { uuid: "rn_ez80qd", runKey: "user:usr_de66mv", workflowId: "welcome-drip", state: "canceled", version: 7, trigger: "user.created", triggerSummary: "tess@vellum.gg", currentStep: null, startedAt: "10h ago", nextWakeAt: null, stepsRecorded: 2, errorSummary: null },
  { uuid: "rn_km77ds", runKey: "user:usr_qy88fh", workflowId: "welcome-drip", state: "completed", version: 7, trigger: "user.created", triggerSummary: "ben@copper.sh", currentStep: null, startedAt: "22h ago", nextWakeAt: null, stepsRecorded: 5, errorSummary: null },

  // alert-me-on-special-signups
  { uuid: "rn_vv12ae", runKey: "user:usr_zc55tn", workflowId: "alert-me-on-special-signups", state: "completed", version: 2, trigger: "user.created", triggerSummary: "noor@stellar.so (VIP domain)", currentStep: null, startedAt: "2m ago", nextWakeAt: null, stepsRecorded: 2, errorSummary: null },
  { uuid: "rn_hh93tw", runKey: "user:usr_rr20cx", workflowId: "alert-me-on-special-signups", state: "failed", version: 2, trigger: "user.created", triggerSummary: "iris@meridian.vc", currentStep: "notify-slack", startedAt: "6h ago", nextWakeAt: null, stepsRecorded: 1, errorSummary: "StepResultTooLargeError: 1.4 MiB result exceeds the 1 MiB step-result limit" },
  { uuid: "rn_pn30zu", runKey: "user:usr_ll41om", workflowId: "alert-me-on-special-signups", state: "completed", version: 1, trigger: "user.created", triggerSummary: "kofi@atlascorp.com", currentStep: null, startedAt: "1d ago", nextWakeAt: null, stepsRecorded: 2, errorSummary: null },

  // trial-expiry-reminder
  { uuid: "rn_wk38dj", runKey: "user:usr_a9p2vf", workflowId: "trial-expiry-reminder", state: "sleeping", version: 3, trigger: "user.created", triggerSummary: "kai@fjord.dk", currentStep: "sleep-until-t-minus-3d", startedAt: "11d ago", nextWakeAt: "in 3d", stepsRecorded: 1, errorSummary: null },
  { uuid: "rn_os59gr", runKey: "user:usr_qq31bn", workflowId: "trial-expiry-reminder", state: "sleeping", version: 3, trigger: "user.created", triggerSummary: "elif@comet.tr", currentStep: "sleep-until-t-minus-3d", startedAt: "5h ago", nextWakeAt: "in 8d", stepsRecorded: 1, errorSummary: null },
  { uuid: "rn_cf72am", runKey: "user:usr_hh40xe", workflowId: "trial-expiry-reminder", state: "completed", version: 3, trigger: "user.created", triggerSummary: "omar@quill.ai", currentStep: null, startedAt: "14d ago", nextWakeAt: null, stepsRecorded: 4, errorSummary: null },
  { uuid: "rn_ta66pl", runKey: "user:usr_gg17nb", workflowId: "trial-expiry-reminder", state: "failed", version: 3, trigger: "user.created", triggerSummary: "zoe@drift.nz", currentStep: "send-reminder-email", startedAt: "13h ago", nextWakeAt: null, stepsRecorded: 3, errorSummary: "NonRetriableError: user has no primary email" },

  // order-fulfillment
  { uuid: "rn_ha83vv", runKey: "order:ord_20261874", workflowId: "order-fulfillment", state: "running", version: 5, trigger: "custom.order.shipped", triggerSummary: "order #20261874 · 3 items", currentStep: "poll-carrier-status", startedAt: "11m ago", nextWakeAt: null, stepsRecorded: 4, errorSummary: null },
  { uuid: "rn_dn27qk", runKey: "order:ord_20261870", workflowId: "order-fulfillment", state: "sleeping", version: 5, trigger: "custom.order.shipped", triggerSummary: "order #20261870 · 1 item", currentStep: "wait-carrier-window", startedAt: "3h ago", nextWakeAt: "in 21h", stepsRecorded: 2, errorSummary: null },
  { uuid: "rn_lp90bz", runKey: "order:ord_20261859", workflowId: "order-fulfillment", state: "completed", version: 5, trigger: "custom.order.shipped", triggerSummary: "order #20261859 · 2 items", currentStep: null, startedAt: "19h ago", nextWakeAt: null, stepsRecorded: 6, errorSummary: null },
  { uuid: "rn_ye45mt", runKey: "order:ord_20261812", workflowId: "order-fulfillment", state: "failed", version: 4, trigger: "custom.order.shipped", triggerSummary: "order #20261812 · 5 items", currentStep: "send-tracking-email", startedAt: "9h ago", nextWakeAt: null, stepsRecorded: 5, errorSummary: "StepTimeoutError: poll-carrier-status exceeded 2m attempt timeout (4/4 attempts)" },
  { uuid: "rn_qa35hn", runKey: "order:ord_20261881", workflowId: "order-fulfillment", state: "queued", version: 5, trigger: "custom.order.shipped", triggerSummary: "order #20261881 · 2 items", currentStep: null, startedAt: "just now", nextWakeAt: null, stepsRecorded: 0, errorSummary: null },
  { uuid: "rn_uc09re", runKey: "order:ord_20261844", workflowId: "order-fulfillment", state: "completed", version: 4, trigger: "custom.order.shipped", triggerSummary: "order #20261844 · 1 item", currentStep: null, startedAt: "23h ago", nextWakeAt: null, stepsRecorded: 6, errorSummary: null },

  // team-offboarding
  { uuid: "rn_iy57uf", runKey: "team:team_5f8n2c", workflowId: "team-offboarding", state: "completed", version: 2, trigger: "team.deleted", triggerSummary: "team Rangefinder (4 members)", currentStep: null, startedAt: "10h ago", nextWakeAt: null, stepsRecorded: 5, errorSummary: null },
  { uuid: "rn_zb44cn", runKey: "user:usr_de66mv", workflowId: "team-offboarding", state: "running", version: 2, trigger: "user.deleted", triggerSummary: "usr_de66mv · teams: [team_5f8n2c]", currentStep: "cancel-sibling-runs", startedAt: "4m ago", nextWakeAt: null, stepsRecorded: 1, errorSummary: null },

  // weekly-usage-digest
  { uuid: "rn_ba21ol", runKey: null, workflowId: "weekly-usage-digest", state: "completed", version: 4, trigger: "schedule", triggerSummary: "tick 2026-07-13 11:00 PT", currentStep: null, startedAt: "6d ago", nextWakeAt: null, stepsRecorded: 3, errorSummary: null },
  { uuid: "rn_md73hy", runKey: null, workflowId: "weekly-usage-digest", state: "completed", version: 3, trigger: "schedule", triggerSummary: "tick 2026-07-06 11:00 PT", currentStep: null, startedAt: "13d ago", nextWakeAt: null, stepsRecorded: 3, errorSummary: null },

  // churn-winback
  { uuid: "rn_ju16pw", runKey: "customer:cus_kt77rn", workflowId: "churn-winback", state: "failed", version: 6, trigger: "custom.subscription.churned", triggerSummary: "cus_kt77rn · Pro plan", currentStep: "send-discount-email", startedAt: "7h ago", nextWakeAt: null, stepsRecorded: 3, errorSummary: "TemplateNotFoundError: templateId \"winback-discount-v2\" does not exist (4/4 attempts)" },
  { uuid: "rn_gm94ce", runKey: "customer:cus_wb02hs", workflowId: "churn-winback", state: "failed", version: 6, trigger: "custom.subscription.churned", triggerSummary: "cus_wb02hs · Team plan", currentStep: "send-discount-email", startedAt: "9h ago", nextWakeAt: null, stepsRecorded: 3, errorSummary: "TemplateNotFoundError: templateId \"winback-discount-v2\" does not exist (4/4 attempts)" },
  { uuid: "rn_rz63kt", runKey: "customer:cus_nn19aq", workflowId: "churn-winback", state: "sleeping", version: 6, trigger: "custom.subscription.churned", triggerSummary: "cus_nn19aq · Pro plan", currentStep: "wait-second-touch", startedAt: "2d ago", nextWakeAt: "in 5d", stepsRecorded: 2, errorSummary: null },
  { uuid: "rn_ew51xb", runKey: "customer:cus_pd63wl", workflowId: "churn-winback", state: "running", version: 6, trigger: "custom.subscription.churned", triggerSummary: "cus_pd63wl · Growth plan", currentStep: "fetch-customer", startedAt: "1m ago", nextWakeAt: null, stepsRecorded: 0, errorSummary: null },
];

// Deterministic backlog of historical runs so the infinite-scroll grids have
// real volume to page through (no Math.random — same rows on every render).
const HISTORICAL_RUN_COUNT = 240;

const RUN_KEY_PREFIXES = new Map<string, string | null>([
  ["welcome-drip", "user:usr_"],
  ["alert-me-on-special-signups", "user:usr_"],
  ["trial-expiry-reminder", "user:usr_"],
  ["order-fulfillment", "order:ord_"],
  ["team-offboarding", "team:team_"],
  ["weekly-usage-digest", null],
  ["churn-winback", "customer:cus_"],
]);

const MOCK_HISTORICAL_RUNS: MockRun[] = Array.from({ length: HISTORICAL_RUN_COUNT }, (_, index) => {
  const workflow = MOCK_WORKFLOWS[index % MOCK_WORKFLOWS.length];
  // null = keyless workflow (scheduled); undefined = missing map entry, which
  // would silently mislabel runs, so fail loudly instead.
  const keyPrefix = RUN_KEY_PREFIXES.get(workflow.id);
  if (keyPrefix === undefined) {
    throw new Error(`No run-key prefix entry for workflow "${workflow.id}" — RUN_KEY_PREFIXES must cover every MOCK_WORKFLOWS entry`);
  }
  const suffix = ((index + 7) * 2654435761 % 60466176).toString(36).padStart(5, "0");
  const failed = index % 19 === 3;
  const daysAgo = 2 + Math.floor(index / 9);
  const version = Math.max(1, workflow.currentVersion - (index % 3 === 0 ? 1 : 0));
  return {
    uuid: `rn_h${String(index).padStart(4, "0")}`,
    runKey: keyPrefix == null ? null : `${keyPrefix}${suffix}`,
    workflowId: workflow.id,
    state: failed ? "failed" : "completed",
    version,
    trigger: workflow.triggers[0].kind === "schedule" ? "schedule" : workflow.triggers[0].label,
    triggerSummary: keyPrefix == null ? `tick ${daysAgo}d ago` : `${keyPrefix}${suffix}`,
    currentStep: null,
    startedAt: `${daysAgo}d ago`,
    nextWakeAt: null,
    stepsRecorded: 3 + (index % 4),
    errorSummary: failed ? "StepTimeoutError: attempt exceeded the 2m default step timeout (4/4 attempts)" : null,
  };
});

export function getRunsForWorkflow(workflowId: string): MockRun[] {
  return [...MOCK_RUNS, ...MOCK_HISTORICAL_RUNS].filter((run) => run.workflowId === workflowId);
}

export type MockVersion = {
  version: number,
  deployedAt: string,
  activeRuns: number,
  sleepingRuns: number,
  pausedRuns: number,
  isCurrent: boolean,
  code: string,
};

const WELCOME_DRIP_V8_CODE = `import { workflow, hexclaveApp } from "@hexclave/workflows";
import { addDays } from "date-fns";

export default workflow("welcome-drip", {
  on: ["user.created"],
  runKey: (event) => \`user:\${event.data.id}\`,
  onConflict: "skip",
}, async (event, step) => {
  await step.sleepUntil("wait-1-day", addDays(event.ts, 1));

  // Guard step: payloads are snapshots at event time, so re-fetch before
  // every side effect. A deleted user self-cancels the run.
  const user = await step.run("recheck-user", () =>
    hexclaveApp.getUser(event.data.id));
  if (user == null) return;

  const prefs = await step.run("check-unsubscribe", () =>
    hexclaveApp.getNotificationPreferences(user.id));
  if (prefs.marketing === false) return;

  await step.run("send-intro-email-v2", () =>
    hexclaveApp.sendEmail({ userIds: [user.id], templateId: "product-intro-v2" }));
});
`;

const WELCOME_DRIP_V7_CODE = `import { workflow, hexclaveApp } from "@hexclave/workflows";
import { addDays } from "date-fns";

export default workflow("welcome-drip", {
  on: ["user.created"],
  runKey: (event) => \`user:\${event.data.id}\`,
  onConflict: "skip",
}, async (event, step) => {
  await step.sleepUntil("wait-1-day", addDays(event.ts, 1));

  const user = await step.run("recheck-user", () =>
    hexclaveApp.getUser(event.data.id));
  if (user == null) return;

  await step.run("send-intro-email", () =>
    hexclaveApp.sendEmail({ userIds: [user.id], templateId: "product-intro" }));
});
`;

const WELCOME_DRIP_V6_CODE = `import { workflow, hexclaveApp } from "@hexclave/workflows";

export default workflow("welcome-drip", {
  on: ["user.created"],
  runKey: (event) => \`user:\${event.data.id}\`,
  onConflict: "skip",
}, async (event, step) => {
  await step.sleep("wait-1-day", "24h");

  const user = await step.run("recheck-user", () =>
    hexclaveApp.getUser(event.data.id));
  if (user == null) return;

  await step.run("send-intro-email", () =>
    hexclaveApp.sendEmail({ userIds: [user.id], templateId: "product-intro" }));
});
`;

const ALERT_SIGNUPS_V2_CODE = `import { workflow, hexclaveApp } from "@hexclave/workflows";

const VIP_DOMAINS = ["stellar.so", "meridian.vc", "atlascorp.com"];

export default workflow("alert-me-on-special-signups", {
  on: ["user.created"],
  runKey: (event) => \`user:\${event.data.id}\`,
  onConflict: "skip",
}, async (event, step) => {
  const domain = event.data.primary_email?.split("@")[1];
  if (domain == null || !VIP_DOMAINS.includes(domain)) return;

  await step.run("notify-slack", () =>
    fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      body: JSON.stringify({ text: \`VIP signup: \${event.data.primary_email}\` }),
    }));

  await step.run("tag-user", () =>
    hexclaveApp.updateUser(event.data.id, { serverMetadata: { vip: true } }));
});
`;

const ALERT_SIGNUPS_V1_CODE = `import { workflow } from "@hexclave/workflows";

export default workflow("alert-me-on-special-signups", {
  on: ["user.created"],
}, async (event, step) => {
  await step.run("notify-slack", () =>
    fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      body: JSON.stringify({ text: \`New signup: \${event.data.primary_email}\` }),
    }));
});
`;

const TRIAL_EXPIRY_V3_CODE = `import { workflow, hexclaveApp } from "@hexclave/workflows";
import { subDays, addDays } from "date-fns";

export default workflow("trial-expiry-reminder", {
  on: ["user.created"],
  runKey: (event) => \`user:\${event.data.id}\`,
  onConflict: "skip",
}, async (event, step) => {
  const trialEnd = addDays(event.ts, 14);
  await step.sleepUntil("sleep-until-t-minus-3d", subDays(trialEnd, 3));

  const user = await step.run("recheck-user", () =>
    hexclaveApp.getUser(event.data.id));
  if (user == null) return;
  if (user.serverMetadata?.plan !== "trial") return; // already upgraded

  await step.run("send-reminder-email", () =>
    hexclaveApp.sendEmail({ userIds: [user.id], templateId: "trial-expiry" }));
});
`;

const ORDER_FULFILLMENT_V5_CODE = `import { workflow, customEvent, NonRetriableError, hexclaveApp } from "@hexclave/workflows";

type OrderShipped = { orderId: string, carrier: string, trackingId: string };

export default workflow("order-fulfillment", {
  on: [customEvent<OrderShipped>("order.shipped")],
  runKey: (event) => \`order:\${event.data.orderId}\`,
  onConflict: "skip",
}, async (event, step) => {
  const order = await step.run("fetch-order", () =>
    hexclaveApp.dataVault.get("orders", event.data.orderId));

  await step.sleep("wait-carrier-window", "24h");

  // Carrier APIs are slow; override the 2m default attempt timeout.
  const status = await step.run("poll-carrier-status", async () => {
    const res = await fetch(carrierUrl(event.data));
    if (res.status === 404) throw new NonRetriableError("unknown tracking id");
    return await res.json();
  }, { timeout: "5m" });

  await step.run("send-tracking-email", () =>
    hexclaveApp.sendEmail({
      userIds: [order.userId],
      templateId: "tracking-update",
      variables: { eta: status.eta },
    }));
});
`;

const ORDER_FULFILLMENT_V4_CODE = `import { workflow, customEvent, hexclaveApp } from "@hexclave/workflows";

export default workflow("order-fulfillment", {
  on: [customEvent("order.shipped")],
  runKey: (event) => \`order:\${event.data.orderId}\`,
  onConflict: "skip",
}, async (event, step) => {
  const order = await step.run("fetch-order", () =>
    hexclaveApp.dataVault.get("orders", event.data.orderId));

  await step.sleep("wait-carrier-window", "24h");

  const status = await step.run("poll-carrier-status", async () =>
    await (await fetch(carrierUrl(event.data))).json());

  await step.run("send-tracking-email", () =>
    hexclaveApp.sendEmail({ userIds: [order.userId], templateId: "tracking-update" }));
});
`;

const TEAM_OFFBOARDING_V2_CODE = `import { workflow, hexclaveApp } from "@hexclave/workflows";

export default workflow("team-offboarding", {
  on: ["team.deleted", "user.deleted"],
}, async (event, step) => {
  // Cancellation policy as a workflow: no cancelOn sugar in v1, so this
  // reacts to deletions and cancels the runs that no longer make sense.
  await step.run("cancel-sibling-runs", () =>
    hexclaveApp.workflows.cancelRun({
      workflow: "welcome-drip",
      runKey: \`user:\${event.data.id}\`,
    }));

  await step.run("notify-owners", () =>
    hexclaveApp.workflows.send("offboarding.started", { entityId: event.data.id }));
});
`;

const WEEKLY_DIGEST_V4_CODE = `import { workflow, schedule, hexclaveApp } from "@hexclave/workflows";

export default workflow("weekly-usage-digest", {
  // Timezone is required — there is no silent UTC default.
  on: [schedule("0 11 * * 1", { timezone: "America/Los_Angeles" })],
}, async (event, step) => {
  const usage = await step.run("aggregate-usage", () =>
    hexclaveApp.analytics.query("weekly-usage-rollup"));

  const admins = await step.run("list-admins", () =>
    hexclaveApp.listUsers({ permission: "admin" }));

  await step.run("send-digest", () =>
    hexclaveApp.sendEmail({
      userIds: admins.map((admin) => admin.id),
      templateId: "usage-digest",
      variables: { usage },
    }));
});
`;

const CHURN_WINBACK_V6_CODE = `import { workflow, customEvent, hexclaveApp } from "@hexclave/workflows";

export default workflow("churn-winback", {
  on: [customEvent("subscription.churned")],
  runKey: (event) => \`customer:\${event.data.customerId}\`,
  onConflict: "cancel-existing", // restart the sequence on repeat churn
}, async (event, step) => {
  const customer = await step.run("fetch-customer", () =>
    hexclaveApp.payments.getCustomer(event.data.customerId));

  await step.sleep("wait-first-touch", "2h");
  await step.run("send-winback-email", () =>
    hexclaveApp.sendEmail({ userIds: [customer.userId], templateId: "winback" }));

  await step.sleep("wait-second-touch", "7d");
  await step.run("send-discount-email", () =>
    hexclaveApp.sendEmail({ userIds: [customer.userId], templateId: "winback-discount-v2" }));
});
`;

const CHURN_WINBACK_V5_CODE = `import { workflow, customEvent, hexclaveApp } from "@hexclave/workflows";

export default workflow("churn-winback", {
  on: [customEvent("subscription.churned")],
  runKey: (event) => \`customer:\${event.data.customerId}\`,
  onConflict: "cancel-existing",
}, async (event, step) => {
  const customer = await step.run("fetch-customer", () =>
    hexclaveApp.payments.getCustomer(event.data.customerId));

  await step.sleep("wait-first-touch", "2h");
  await step.run("send-winback-email", () =>
    hexclaveApp.sendEmail({ userIds: [customer.userId], templateId: "winback" }));
});
`;

export const MOCK_WORKFLOW_VERSIONS = new Map<string, MockVersion[]>([
  ["welcome-drip", [
    { version: 8, deployedAt: "2h ago", activeRuns: 0, sleepingRuns: 0, pausedRuns: 3, isCurrent: true, code: WELCOME_DRIP_V8_CODE },
    { version: 7, deployedAt: "9d ago", activeRuns: 9, sleepingRuns: 205, pausedRuns: 0, isCurrent: false, code: WELCOME_DRIP_V7_CODE },
    { version: 6, deployedAt: "23d ago", activeRuns: 0, sleepingRuns: 0, pausedRuns: 0, isCurrent: false, code: WELCOME_DRIP_V6_CODE },
  ]],
  ["alert-me-on-special-signups", [
    { version: 2, deployedAt: "5d ago", activeRuns: 0, sleepingRuns: 0, pausedRuns: 0, isCurrent: true, code: ALERT_SIGNUPS_V2_CODE },
    { version: 1, deployedAt: "21d ago", activeRuns: 0, sleepingRuns: 0, pausedRuns: 0, isCurrent: false, code: ALERT_SIGNUPS_V1_CODE },
  ]],
  ["trial-expiry-reminder", [
    { version: 3, deployedAt: "6d ago", activeRuns: 2, sleepingRuns: 641, pausedRuns: 0, isCurrent: true, code: TRIAL_EXPIRY_V3_CODE },
  ]],
  ["order-fulfillment", [
    { version: 5, deployedAt: "1d ago", activeRuns: 34, sleepingRuns: 68, pausedRuns: 0, isCurrent: true, code: ORDER_FULFILLMENT_V5_CODE },
    { version: 4, deployedAt: "8d ago", activeRuns: 0, sleepingRuns: 19, pausedRuns: 0, isCurrent: false, code: ORDER_FULFILLMENT_V4_CODE },
  ]],
  ["team-offboarding", [
    { version: 2, deployedAt: "12d ago", activeRuns: 1, sleepingRuns: 0, pausedRuns: 0, isCurrent: true, code: TEAM_OFFBOARDING_V2_CODE },
  ]],
  ["weekly-usage-digest", [
    { version: 4, deployedAt: "3d ago", activeRuns: 0, sleepingRuns: 0, pausedRuns: 0, isCurrent: true, code: WEEKLY_DIGEST_V4_CODE },
  ]],
  ["churn-winback", [
    { version: 6, deployedAt: "4h ago", activeRuns: 3, sleepingRuns: 44, pausedRuns: 0, isCurrent: true, code: CHURN_WINBACK_V6_CODE },
    { version: 5, deployedAt: "15d ago", activeRuns: 0, sleepingRuns: 0, pausedRuns: 0, isCurrent: false, code: CHURN_WINBACK_V5_CODE },
  ]],
]);

export function getVersionsForWorkflow(workflowId: string): MockVersion[] {
  const versions = MOCK_WORKFLOW_VERSIONS.get(workflowId);
  if (versions == null) {
    throw new Error(`No mock versions for workflow "${workflowId}" — every MOCK_WORKFLOWS entry needs a MOCK_WORKFLOW_VERSIONS entry`);
  }
  return versions;
}

export function getWorkflowFileName(workflowId: string): string {
  return `workflows/${workflowId}.ts`;
}

