export type IncidentSeverity = "SEV-1" | "SEV-2";

export type IncidentStageKind = "healthy" | "change" | "impact" | "diagnosis" | "mitigation" | "recovery";

export type MetricUnit = "percent" | "milliseconds" | "count" | "requests-per-minute" | "dollars";

export type IncidentMetric = {
  id: string,
  label: string,
  unit: MetricUnit,
  higherIsWorse: boolean,
  baseline: number,
  current: number,
  recovered: number,
};

export type StageMetricValue = {
  metricId: string,
  value: number,
};

export type IncidentStage = {
  id: string,
  kind: IncidentStageKind,
  offsetMs: number,
  title: string,
  summary: string,
  metricValues: StageMetricValue[],
  evidenceIds: string[],
};

export type StackFrame = {
  functionName: string,
  file: string,
  line: number,
  column: number,
  inApplication: boolean,
};

export type Breadcrumb = {
  offsetMs: number,
  category: "navigation" | "ui" | "http" | "console" | "queue" | "ai",
  message: string,
  level: "info" | "warning" | "error",
};

export type IncidentError = {
  id: string,
  stageId: string,
  fingerprint: string,
  title: string,
  message: string,
  count: number,
  affectedUsers: number,
  traceId: string,
  spanId: string,
  stackFrames: StackFrame[],
  breadcrumbs: Breadcrumb[],
};

export type LogAttribute = {
  key: string,
  value: string | number | boolean,
};

export type StructuredLog = {
  id: string,
  stageId: string,
  offsetMs: number,
  timestamp: string,
  level: "debug" | "info" | "warn" | "error",
  service: string,
  message: string,
  traceId: string,
  spanId: string,
  attributes: LogAttribute[],
};

export type WaterfallSpan = {
  id: string,
  parentId: string | null,
  traceId: string,
  service: string,
  operation: string,
  startOffsetMs: number,
  durationMs: number,
  status: "ok" | "error",
  attributes: LogAttribute[],
};

export type ReplayFrame = {
  id: string,
  stageId: string,
  offsetMs: number,
  route: string,
  title: string,
  description: string,
  cursorX: number,
  cursorY: number,
  viewportWidth: number,
  viewportHeight: number,
  highlightedSelector: string | null,
};

export type DeploymentMetadata = {
  id: string,
  environment: "production",
  service: string,
  version: string,
  startedAt: string,
  completedAt: string,
  status: "succeeded" | "rolled-back",
};

export type ConfigChange = {
  key: string,
  previousValue: string,
  nextValue: string,
  changedAt: string,
  changedBy: string,
};

export type FeatureFlagMetadata = {
  key: string,
  previousVariant: string,
  currentVariant: string,
  rolloutPercent: number,
  changedAt: string,
};

export type ChangeMetadata = {
  deployment: DeploymentMetadata,
  configChanges: ConfigChange[],
  featureFlags: FeatureFlagMetadata[],
};

export type ChangedLine = {
  file: string,
  startLine: number,
  endLine: number,
  summary: string,
};

export type SuspectChange = {
  commitSha: string,
  commitTitle: string,
  pullRequestNumber: number,
  pullRequestTitle: string,
  author: string,
  owner: string,
  mergedAt: string,
  changedLines: ChangedLine[],
};

export type RootCauseEvidence = {
  id: string,
  stageId: string,
  signal: string,
  explanation: string,
  confidence: number,
  supportingEvidenceIds: string[],
};

export type RemediationAction = {
  id: string,
  title: string,
  owner: string,
  status: "completed" | "in-progress" | "planned",
  completedAt: string | null,
  details: string,
};

export type SloData = {
  objective: string,
  targetPercent: number,
  windowDays: number,
  observedPercent: number,
  burnRate: number,
  budgetRemainingBeforePercent: number,
  budgetRemainingCurrentPercent: number,
  projectedMinutesToExhaustion: number,
};

export type TopologyNode = {
  id: string,
  label: string,
  kind: "browser" | "edge" | "service" | "database" | "queue" | "provider" | "ai-model",
  health: "healthy" | "degraded" | "critical",
  requestRate: number,
  errorRatePercent: number,
  latencyP95Ms: number,
};

export type TopologyEdge = {
  id: string,
  source: string,
  target: string,
  protocol: "HTTPS" | "gRPC" | "SQL" | "queue" | "tool-call",
  health: "healthy" | "degraded" | "critical",
  requestsPerMinute: number,
};

export type ServiceTopology = {
  nodes: TopologyNode[],
  edges: TopologyEdge[],
};

export type IncidentStory = {
  id: string,
  title: string,
  shortTitle: string,
  severity: IncidentSeverity,
  status: "resolved",
  startedAt: string,
  resolvedAt: string,
  durationMs: number,
  summary: string,
  userImpact: string,
  businessImpact: string,
  affectedUsers: number,
  affectedRegion: string,
  metrics: IncidentMetric[],
  stages: IncidentStage[],
  errors: IncidentError[],
  logs: StructuredLog[],
  waterfallSpans: WaterfallSpan[],
  replayFrames: ReplayFrame[],
  change: ChangeMetadata,
  suspect: SuspectChange,
  rootCauseEvidence: RootCauseEvidence[],
  remediationActions: RemediationAction[],
  slo: SloData,
  topology: ServiceTopology,
};

export function getPlaybackStage(story: IncidentStory, elapsedMs: number): IncidentStage | undefined {
  let selected = story.stages[0];
  for (const stage of story.stages) {
    if (stage.offsetMs > elapsedMs) break;
    selected = stage;
  }
  return selected;
}

export function interpolateMetric(from: number, to: number, progress: number): number {
  const clampedProgress = Math.min(Math.max(progress, 0), 1);
  return from + (to - from) * clampedProgress;
}

export function formatPlaybackTime(elapsedMs: number): string {
  const clampedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const totalSeconds = Math.floor(clampedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const safariStory: IncidentStory = {
  id: "safari-webcrypto-checkout",
  title: "Safari checkout failures after WebCrypto rollout",
  shortTitle: "Safari checkout",
  severity: "SEV-1",
  status: "resolved",
  startedAt: "2026-06-18T14:02:00.000Z",
  resolvedAt: "2026-06-18T14:14:00.000Z",
  durationMs: 720_000,
  summary: "A WebCrypto tokenization path enabled by a production flag rejected Safari checkout sessions.",
  userImpact: "Safari shoppers saw payment confirmation fail after submitting otherwise valid card details.",
  businessImpact: "An estimated $184,200 in checkout volume was delayed; recovered carts were offered a retry.",
  affectedUsers: 4_812,
  affectedRegion: "Global, Safari 17.4–17.5",
  metrics: [
    { id: "checkout-error-rate", label: "Checkout error rate", unit: "percent", higherIsWorse: true, baseline: 0.7, current: 31.8, recovered: 0.9 },
    { id: "checkout-p95", label: "Checkout p95", unit: "milliseconds", higherIsWorse: true, baseline: 820, current: 4_900, recovered: 880 },
    { id: "revenue-at-risk", label: "Revenue at risk", unit: "dollars", higherIsWorse: true, baseline: 0, current: 184_200, recovered: 12_400 },
  ],
  stages: [
    { id: "safari-healthy", kind: "healthy", offsetMs: 0, title: "Healthy baseline", summary: "Checkout conversion and latency are within objective.", metricValues: [{ metricId: "checkout-error-rate", value: 0.7 }, { metricId: "checkout-p95", value: 820 }], evidenceIds: [] },
    { id: "safari-change", kind: "change", offsetMs: 60_000, title: "WebCrypto flag reaches 100%", summary: "Deploy checkout-web 8.42.0 completes and secure-token-v2 expands globally.", metricValues: [{ metricId: "checkout-error-rate", value: 1.1 }, { metricId: "checkout-p95", value: 900 }], evidenceIds: ["log-safari-deploy"] },
    { id: "safari-impact", kind: "impact", offsetMs: 150_000, title: "Safari failures spike", summary: "SubtleCrypto rejects a legacy key encoding used only by the Safari adapter.", metricValues: [{ metricId: "checkout-error-rate", value: 31.8 }, { metricId: "checkout-p95", value: 4_900 }], evidenceIds: ["err-safari-crypto", "span-safari-tokenize", "replay-safari-error"] },
    { id: "safari-diagnosis", kind: "diagnosis", offsetMs: 300_000, title: "Browser correlation isolated", summary: "AI analysis links the failures to Safari, the flag cohort, and the rollout commit.", metricValues: [{ metricId: "checkout-error-rate", value: 28.4 }, { metricId: "checkout-p95", value: 4_500 }], evidenceIds: ["rc-safari-correlation"] },
    { id: "safari-mitigation", kind: "mitigation", offsetMs: 480_000, title: "Flag rolled back", summary: "Safari traffic returns to the previous tokenization implementation.", metricValues: [{ metricId: "checkout-error-rate", value: 8.2 }, { metricId: "checkout-p95", value: 1_600 }], evidenceIds: ["log-safari-rollback"] },
    { id: "safari-recovery", kind: "recovery", offsetMs: 660_000, title: "Checkout recovered", summary: "Error rate and conversion return to baseline.", metricValues: [{ metricId: "checkout-error-rate", value: 0.9 }, { metricId: "checkout-p95", value: 880 }], evidenceIds: [] },
  ],
  errors: [{
    id: "err-safari-crypto",
    stageId: "safari-impact",
    fingerprint: "checkout-webcrypto-dataerror-safari",
    title: "DataError: invalid keyData",
    message: "Failed to execute 'importKey' on 'SubtleCrypto': The provided data is invalid.",
    count: 6_204,
    affectedUsers: 4_812,
    traceId: "trace-safari-7d2c",
    spanId: "span-safari-tokenize",
    stackFrames: [
      { functionName: "importCheckoutKey", file: "src/crypto/webcrypto-tokenizer.ts", line: 118, column: 24, inApplication: true },
      { functionName: "tokenizePaymentMethod", file: "src/checkout/payment-session.ts", line: 204, column: 17, inApplication: true },
      { functionName: "confirmOrder", file: "src/checkout/confirm-order.ts", line: 77, column: 11, inApplication: true },
    ],
    breadcrumbs: [
      { offsetMs: 143_000, category: "ui", message: "Customer clicked Place order", level: "info" },
      { offsetMs: 143_180, category: "http", message: "POST /payment-session returned 200", level: "info" },
      { offsetMs: 143_240, category: "console", message: "WebCrypto key import failed", level: "error" },
    ],
  }],
  logs: [
    { id: "log-safari-deploy", stageId: "safari-change", offsetMs: 60_000, timestamp: "2026-06-18T14:03:00.000Z", level: "info", service: "release-controller", message: "Production rollout completed", traceId: "trace-deploy-8420", spanId: "span-deploy-complete", attributes: [{ key: "version", value: "8.42.0" }, { key: "flag.secure-token-v2", value: "enabled" }] },
    { id: "log-safari-error", stageId: "safari-impact", offsetMs: 151_000, timestamp: "2026-06-18T14:04:31.000Z", level: "error", service: "checkout-web", message: "Payment tokenization failed", traceId: "trace-safari-7d2c", spanId: "span-safari-tokenize", attributes: [{ key: "browser", value: "Safari 17.5" }, { key: "crypto.provider", value: "WebCrypto" }, { key: "flag.variant", value: "enabled" }] },
    { id: "log-safari-rollback", stageId: "safari-mitigation", offsetMs: 480_000, timestamp: "2026-06-18T14:10:00.000Z", level: "warn", service: "flag-controller", message: "Feature flag rolled back", traceId: "trace-flag-rollback", spanId: "span-flag-write", attributes: [{ key: "flag", value: "secure-token-v2" }, { key: "rollout_percent", value: 0 }] },
  ],
  waterfallSpans: [
    { id: "span-safari-checkout", parentId: null, traceId: "trace-safari-7d2c", service: "checkout-web", operation: "POST /checkout/confirm", startOffsetMs: 143_000, durationMs: 1_240, status: "error", attributes: [{ key: "browser", value: "Safari" }] },
    { id: "span-safari-session", parentId: "span-safari-checkout", traceId: "trace-safari-7d2c", service: "payment-api", operation: "create payment session", startOffsetMs: 143_140, durationMs: 210, status: "ok", attributes: [{ key: "status_code", value: 200 }] },
    { id: "span-safari-tokenize", parentId: "span-safari-checkout", traceId: "trace-safari-7d2c", service: "checkout-web", operation: "webcrypto.importKey", startOffsetMs: 143_360, durationMs: 24, status: "error", attributes: [{ key: "exception.type", value: "DataError" }] },
  ],
  replayFrames: [
    { id: "replay-safari-submit", stageId: "safari-impact", offsetMs: 143_000, route: "/checkout/payment", title: "Order submitted", description: "A fictional shopper submits valid payment details.", cursorX: 904, cursorY: 691, viewportWidth: 1440, viewportHeight: 900, highlightedSelector: "[data-action='place-order']" },
    { id: "replay-safari-error", stageId: "safari-impact", offsetMs: 144_300, route: "/checkout/payment", title: "Confirmation fails", description: "The button stops loading and an actionable retry message appears.", cursorX: 904, cursorY: 691, viewportWidth: 1440, viewportHeight: 900, highlightedSelector: "[role='alert']" },
  ],
  change: {
    deployment: { id: "dep-checkout-8420", environment: "production", service: "checkout-web", version: "8.42.0", startedAt: "2026-06-18T14:01:20.000Z", completedAt: "2026-06-18T14:03:00.000Z", status: "rolled-back" },
    configChanges: [{ key: "crypto.keyFormat", previousValue: "raw", nextValue: "spki", changedAt: "2026-06-18T14:03:00.000Z", changedBy: "release-controller" }],
    featureFlags: [{ key: "secure-token-v2", previousVariant: "disabled", currentVariant: "enabled", rolloutPercent: 100, changedAt: "2026-06-18T14:03:00.000Z" }],
  },
  suspect: {
    commitSha: "7d2c9a1",
    commitTitle: "Use WebCrypto for checkout token wrapping",
    pullRequestNumber: 4182,
    pullRequestTitle: "Roll out browser-native payment tokenization",
    author: "Mira Chen",
    owner: "Payments Platform",
    mergedAt: "2026-06-18T13:42:00.000Z",
    changedLines: [
      { file: "src/crypto/webcrypto-tokenizer.ts", startLine: 96, endLine: 124, summary: "Selects SPKI key import for the new browser path." },
      { file: "src/checkout/payment-session.ts", startLine: 198, endLine: 210, summary: "Routes enabled cohorts through WebCrypto." },
    ],
  },
  rootCauseEvidence: [
    { id: "rc-safari-correlation", stageId: "safari-diagnosis", signal: "Cohort correlation", explanation: "99.2% of failures are Safari sessions in the enabled flag cohort; control traffic remains healthy.", confidence: 0.98, supportingEvidenceIds: ["err-safari-crypto", "log-safari-deploy"] },
    { id: "rc-safari-code", stageId: "safari-diagnosis", signal: "Stack-to-diff match", explanation: "The top application frame intersects the only changed key-import lines in the suspect commit.", confidence: 0.96, supportingEvidenceIds: ["err-safari-crypto", "span-safari-tokenize"] },
  ],
  remediationActions: [
    { id: "rem-safari-rollback", title: "Disable secure-token-v2", owner: "Payments Platform", status: "completed", completedAt: "2026-06-18T14:10:00.000Z", details: "Returned all browsers to the compatible tokenization path." },
    { id: "rem-safari-test", title: "Add Safari WebCrypto compatibility suite", owner: "Checkout Quality", status: "in-progress", completedAt: null, details: "Covers key encodings on supported Safari releases before rollout." },
  ],
  slo: { objective: "Successful checkout confirmations", targetPercent: 99.9, windowDays: 30, observedPercent: 99.61, burnRate: 18.4, budgetRemainingBeforePercent: 71.2, budgetRemainingCurrentPercent: 52.8, projectedMinutesToExhaustion: 96 },
  topology: {
    nodes: [
      { id: "safari-browser", label: "Safari browser", kind: "browser", health: "critical", requestRate: 8_420, errorRatePercent: 31.8, latencyP95Ms: 4_900 },
      { id: "checkout-web", label: "Checkout Web", kind: "edge", health: "degraded", requestRate: 24_800, errorRatePercent: 10.9, latencyP95Ms: 2_100 },
      { id: "payment-api", label: "Payment API", kind: "service", health: "healthy", requestRate: 23_900, errorRatePercent: 0.3, latencyP95Ms: 290 },
      { id: "payment-provider", label: "Payment Provider", kind: "provider", health: "healthy", requestRate: 23_700, errorRatePercent: 0.2, latencyP95Ms: 340 },
    ],
    edges: [
      { id: "edge-safari-checkout", source: "safari-browser", target: "checkout-web", protocol: "HTTPS", health: "critical", requestsPerMinute: 8_420 },
      { id: "edge-checkout-payment", source: "checkout-web", target: "payment-api", protocol: "HTTPS", health: "healthy", requestsPerMinute: 23_900 },
      { id: "edge-payment-provider", source: "payment-api", target: "payment-provider", protocol: "HTTPS", health: "healthy", requestsPerMinute: 23_700 },
    ],
  },
};

const mfaStory: IncidentStory = {
  id: "mfa-retry-storm",
  title: "MFA retry policy triggered an authentication storm",
  shortTitle: "MFA retry storm",
  severity: "SEV-1",
  status: "resolved",
  startedAt: "2026-06-22T09:30:00.000Z",
  resolvedAt: "2026-06-22T09:48:00.000Z",
  durationMs: 1_080_000,
  summary: "A configuration change removed retry jitter and synchronized failed MFA verification attempts.",
  userImpact: "Users with MFA enabled experienced repeated prompts, delayed verification, and temporary sign-in failures.",
  businessImpact: "Enterprise login success fell by 22%, delaying access for 7,930 employees across fictional tenants.",
  affectedUsers: 7_930,
  affectedRegion: "North America and Europe",
  metrics: [
    { id: "mfa-error-rate", label: "MFA verification errors", unit: "percent", higherIsWorse: true, baseline: 0.5, current: 24.6, recovered: 0.7 },
    { id: "mfa-rpm", label: "MFA verify traffic", unit: "requests-per-minute", higherIsWorse: true, baseline: 12_400, current: 91_000, recovered: 13_100 },
    { id: "mfa-p95", label: "Verification p95", unit: "milliseconds", higherIsWorse: true, baseline: 410, current: 8_700, recovered: 460 },
  ],
  stages: [
    { id: "mfa-healthy", kind: "healthy", offsetMs: 0, title: "Healthy baseline", summary: "MFA verification is stable with randomized backoff.", metricValues: [{ metricId: "mfa-error-rate", value: 0.5 }, { metricId: "mfa-rpm", value: 12_400 }], evidenceIds: [] },
    { id: "mfa-change", kind: "change", offsetMs: 90_000, title: "Retry config published", summary: "Retry delay changes from exponential jitter to a fixed 100 ms interval.", metricValues: [{ metricId: "mfa-error-rate", value: 0.8 }, { metricId: "mfa-rpm", value: 13_800 }], evidenceIds: ["log-mfa-config"] },
    { id: "mfa-impact", kind: "impact", offsetMs: 210_000, title: "Retries synchronize", summary: "Clients retry in lockstep and exhaust verifier capacity.", metricValues: [{ metricId: "mfa-error-rate", value: 24.6 }, { metricId: "mfa-rpm", value: 91_000 }], evidenceIds: ["err-mfa-timeout", "span-mfa-redis"] },
    { id: "mfa-diagnosis", kind: "diagnosis", offsetMs: 420_000, title: "Retry amplification identified", summary: "Trace fan-out and config history identify the missing jitter.", metricValues: [{ metricId: "mfa-error-rate", value: 20.1 }, { metricId: "mfa-rpm", value: 84_500 }], evidenceIds: ["rc-mfa-amplification"] },
    { id: "mfa-mitigation", kind: "mitigation", offsetMs: 720_000, title: "Configuration reverted", summary: "Exponential backoff and jitter are restored.", metricValues: [{ metricId: "mfa-error-rate", value: 5.4 }, { metricId: "mfa-rpm", value: 29_000 }], evidenceIds: ["log-mfa-revert"] },
    { id: "mfa-recovery", kind: "recovery", offsetMs: 1_020_000, title: "Authentication recovered", summary: "Queues drain and successful verification returns to objective.", metricValues: [{ metricId: "mfa-error-rate", value: 0.7 }, { metricId: "mfa-rpm", value: 13_100 }], evidenceIds: [] },
  ],
  errors: [{
    id: "err-mfa-timeout",
    stageId: "mfa-impact",
    fingerprint: "mfa-verifier-capacity-timeout",
    title: "MfaVerificationTimeout",
    message: "MFA verification exceeded the 5 second request deadline.",
    count: 28_411,
    affectedUsers: 7_930,
    traceId: "trace-mfa-a91e",
    spanId: "span-mfa-verify",
    stackFrames: [
      { functionName: "verifyChallenge", file: "src/auth/mfa/verifier.ts", line: 146, column: 19, inApplication: true },
      { functionName: "consumeAttempt", file: "src/auth/mfa/rate-limit.ts", line: 88, column: 13, inApplication: true },
      { functionName: "postMfaVerify", file: "src/routes/mfa.ts", line: 54, column: 9, inApplication: true },
    ],
    breadcrumbs: [
      { offsetMs: 202_000, category: "ui", message: "User submitted authenticator code", level: "info" },
      { offsetMs: 207_000, category: "http", message: "POST /auth/mfa/verify timed out", level: "error" },
      { offsetMs: 207_100, category: "http", message: "Client scheduled retry in 100 ms", level: "warning" },
    ],
  }],
  logs: [
    { id: "log-mfa-config", stageId: "mfa-change", offsetMs: 90_000, timestamp: "2026-06-22T09:31:30.000Z", level: "info", service: "config-controller", message: "Authentication configuration activated", traceId: "trace-config-mfa", spanId: "span-config-publish", attributes: [{ key: "retry.strategy", value: "fixed" }, { key: "retry.delay_ms", value: 100 }, { key: "retry.jitter", value: false }] },
    { id: "log-mfa-overload", stageId: "mfa-impact", offsetMs: 212_000, timestamp: "2026-06-22T09:33:32.000Z", level: "error", service: "mfa-verifier", message: "Verifier concurrency limit reached", traceId: "trace-mfa-a91e", spanId: "span-mfa-verify", attributes: [{ key: "in_flight", value: 5_000 }, { key: "retry_attempt", value: 4 }] },
    { id: "log-mfa-revert", stageId: "mfa-mitigation", offsetMs: 720_000, timestamp: "2026-06-22T09:42:00.000Z", level: "warn", service: "config-controller", message: "Authentication configuration reverted", traceId: "trace-config-revert", spanId: "span-config-publish", attributes: [{ key: "retry.strategy", value: "exponential" }, { key: "retry.jitter", value: true }] },
  ],
  waterfallSpans: [
    { id: "span-mfa-request", parentId: null, traceId: "trace-mfa-a91e", service: "auth-edge", operation: "POST /auth/mfa/verify", startOffsetMs: 202_000, durationMs: 5_010, status: "error", attributes: [{ key: "attempt", value: 4 }] },
    { id: "span-mfa-verify", parentId: "span-mfa-request", traceId: "trace-mfa-a91e", service: "mfa-verifier", operation: "verify TOTP", startOffsetMs: 202_014, durationMs: 4_982, status: "error", attributes: [{ key: "deadline_ms", value: 5_000 }] },
    { id: "span-mfa-redis", parentId: "span-mfa-verify", traceId: "trace-mfa-a91e", service: "attempt-store", operation: "GET mfa_attempt", startOffsetMs: 202_025, durationMs: 4_120, status: "error", attributes: [{ key: "pool.wait_ms", value: 4_090 }] },
  ],
  replayFrames: [
    { id: "replay-mfa-prompt", stageId: "mfa-impact", offsetMs: 202_000, route: "/auth/mfa", title: "Verification submitted", description: "A fictional user enters a valid authenticator code.", cursorX: 720, cursorY: 566, viewportWidth: 1440, viewportHeight: 900, highlightedSelector: "[data-action='verify-mfa']" },
    { id: "replay-mfa-retry", stageId: "mfa-impact", offsetMs: 207_100, route: "/auth/mfa", title: "Automatic retry starts", description: "The client retries too quickly while the first request is still clearing.", cursorX: 720, cursorY: 566, viewportWidth: 1440, viewportHeight: 900, highlightedSelector: "[data-state='retrying']" },
  ],
  change: {
    deployment: { id: "dep-auth-config-119", environment: "production", service: "config-controller", version: "config-119", startedAt: "2026-06-22T09:31:20.000Z", completedAt: "2026-06-22T09:31:30.000Z", status: "rolled-back" },
    configChanges: [
      { key: "auth.mfa.retryStrategy", previousValue: "exponential-jitter", nextValue: "fixed", changedAt: "2026-06-22T09:31:30.000Z", changedBy: "auth-config-bot" },
      { key: "auth.mfa.retryDelayMs", previousValue: "750", nextValue: "100", changedAt: "2026-06-22T09:31:30.000Z", changedBy: "auth-config-bot" },
    ],
    featureFlags: [{ key: "mfa-client-retry-v3", previousVariant: "control", currentVariant: "fixed-delay", rolloutPercent: 100, changedAt: "2026-06-22T09:31:30.000Z" }],
  },
  suspect: {
    commitSha: "a91ef04",
    commitTitle: "Simplify MFA retry configuration",
    pullRequestNumber: 4219,
    pullRequestTitle: "Unify authentication retry defaults",
    author: "Jon Bell",
    owner: "Identity Reliability",
    mergedAt: "2026-06-22T08:55:00.000Z",
    changedLines: [
      { file: "config/authentication.ts", startLine: 44, endLine: 58, summary: "Replaces randomized backoff with a fixed interval." },
      { file: "src/auth/mfa/retry-policy.ts", startLine: 71, endLine: 86, summary: "Reads the shared retry delay for MFA verification." },
    ],
  },
  rootCauseEvidence: [
    { id: "rc-mfa-amplification", stageId: "mfa-diagnosis", signal: "Retry periodicity", explanation: "Request bursts repeat at exactly 100 ms intervals, matching the activated configuration.", confidence: 0.99, supportingEvidenceIds: ["log-mfa-config", "err-mfa-timeout"] },
    { id: "rc-mfa-capacity", stageId: "mfa-diagnosis", signal: "Trace queue time", explanation: "82% of failed trace duration is waiting for the attempt-store pool rather than computing TOTP.", confidence: 0.94, supportingEvidenceIds: ["span-mfa-redis", "log-mfa-overload"] },
  ],
  remediationActions: [
    { id: "rem-mfa-revert", title: "Restore exponential jitter", owner: "Identity Reliability", status: "completed", completedAt: "2026-06-22T09:42:00.000Z", details: "Reverted retry settings and invalidated the fixed-delay configuration." },
    { id: "rem-mfa-guardrail", title: "Add retry amplification policy check", owner: "Platform Safety", status: "planned", completedAt: null, details: "Rejects production configuration with synchronized sub-second retries." },
  ],
  slo: { objective: "Successful MFA verification", targetPercent: 99.95, windowDays: 30, observedPercent: 99.71, burnRate: 24.2, budgetRemainingBeforePercent: 64.5, budgetRemainingCurrentPercent: 39.8, projectedMinutesToExhaustion: 61 },
  topology: {
    nodes: [
      { id: "auth-edge", label: "Auth Edge", kind: "edge", health: "degraded", requestRate: 91_000, errorRatePercent: 24.6, latencyP95Ms: 8_700 },
      { id: "mfa-verifier", label: "MFA Verifier", kind: "service", health: "critical", requestRate: 88_400, errorRatePercent: 25.1, latencyP95Ms: 8_200 },
      { id: "attempt-store", label: "Attempt Store", kind: "database", health: "critical", requestRate: 86_700, errorRatePercent: 9.4, latencyP95Ms: 6_100 },
      { id: "user-directory", label: "User Directory", kind: "database", health: "healthy", requestRate: 12_900, errorRatePercent: 0.1, latencyP95Ms: 48 },
    ],
    edges: [
      { id: "edge-auth-mfa", source: "auth-edge", target: "mfa-verifier", protocol: "gRPC", health: "critical", requestsPerMinute: 88_400 },
      { id: "edge-mfa-attempts", source: "mfa-verifier", target: "attempt-store", protocol: "SQL", health: "critical", requestsPerMinute: 86_700 },
      { id: "edge-mfa-directory", source: "mfa-verifier", target: "user-directory", protocol: "SQL", health: "healthy", requestsPerMinute: 12_900 },
    ],
  },
};

const webhookStory: IncidentStory = {
  id: "webhook-poison-message",
  title: "Poison webhook message blocked queue partitions",
  shortTitle: "Webhook backlog",
  severity: "SEV-2",
  status: "resolved",
  startedAt: "2026-06-25T16:10:00.000Z",
  resolvedAt: "2026-06-25T16:35:00.000Z",
  durationMs: 1_500_000,
  summary: "An unbounded deserialization retry kept a malformed fictional webhook at the head of several queue partitions.",
  userImpact: "Webhook consumers received account and order events up to 21 minutes late.",
  businessImpact: "43 fictional merchants experienced delayed fulfillment automation; no events were lost.",
  affectedUsers: 43,
  affectedRegion: "us-east queue cluster",
  metrics: [
    { id: "webhook-backlog", label: "Queued webhooks", unit: "count", higherIsWorse: true, baseline: 1_200, current: 184_000, recovered: 1_460 },
    { id: "webhook-oldest", label: "Oldest message age", unit: "milliseconds", higherIsWorse: true, baseline: 8_000, current: 1_260_000, recovered: 11_000 },
    { id: "webhook-throughput", label: "Delivery throughput", unit: "requests-per-minute", higherIsWorse: false, baseline: 42_000, current: 5_100, recovered: 41_600 },
  ],
  stages: [
    { id: "webhook-healthy", kind: "healthy", offsetMs: 0, title: "Queue healthy", summary: "Workers keep delivery lag below ten seconds.", metricValues: [{ metricId: "webhook-backlog", value: 1_200 }, { metricId: "webhook-throughput", value: 42_000 }], evidenceIds: [] },
    { id: "webhook-change", kind: "change", offsetMs: 120_000, title: "Worker 5.18.0 deployed", summary: "A parser refactor removes the terminal dead-letter classification.", metricValues: [{ metricId: "webhook-backlog", value: 1_500 }, { metricId: "webhook-throughput", value: 41_700 }], evidenceIds: ["log-webhook-deploy"] },
    { id: "webhook-impact", kind: "impact", offsetMs: 330_000, title: "Poison message loops", summary: "Malformed payloads are retried indefinitely and block partition progress.", metricValues: [{ metricId: "webhook-backlog", value: 184_000 }, { metricId: "webhook-throughput", value: 5_100 }], evidenceIds: ["err-webhook-schema", "span-webhook-decode"] },
    { id: "webhook-diagnosis", kind: "diagnosis", offsetMs: 660_000, title: "Partition heads identified", summary: "AI analysis finds identical message IDs at the head of all stalled partitions.", metricValues: [{ metricId: "webhook-backlog", value: 171_000 }, { metricId: "webhook-throughput", value: 7_800 }], evidenceIds: ["rc-webhook-head"] },
    { id: "webhook-mitigation", kind: "mitigation", offsetMs: 960_000, title: "Messages quarantined", summary: "Poison messages move to the dead-letter queue and workers scale out.", metricValues: [{ metricId: "webhook-backlog", value: 63_000 }, { metricId: "webhook-throughput", value: 68_000 }], evidenceIds: ["log-webhook-quarantine"] },
    { id: "webhook-recovery", kind: "recovery", offsetMs: 1_440_000, title: "Backlog drained", summary: "Delivery lag and throughput return to normal.", metricValues: [{ metricId: "webhook-backlog", value: 1_460 }, { metricId: "webhook-throughput", value: 41_600 }], evidenceIds: [] },
  ],
  errors: [{
    id: "err-webhook-schema",
    stageId: "webhook-impact",
    fingerprint: "webhook-deserialize-missing-event-type",
    title: "WebhookPayloadSchemaError",
    message: "Payload field 'event_type' must be a non-empty string.",
    count: 91_240,
    affectedUsers: 43,
    traceId: "trace-webhook-c4b8",
    spanId: "span-webhook-decode",
    stackFrames: [
      { functionName: "decodeEnvelope", file: "src/worker/envelope-parser.ts", line: 92, column: 15, inApplication: true },
      { functionName: "processDelivery", file: "src/worker/delivery-loop.ts", line: 164, column: 21, inApplication: true },
      { functionName: "consumePartition", file: "src/worker/consumer.ts", line: 58, column: 13, inApplication: true },
    ],
    breadcrumbs: [
      { offsetMs: 324_000, category: "queue", message: "Dequeued fictional message wh_msg_demo_1042", level: "info" },
      { offsetMs: 324_020, category: "console", message: "Payload validation failed", level: "error" },
      { offsetMs: 324_120, category: "queue", message: "Message returned to partition head", level: "warning" },
    ],
  }],
  logs: [
    { id: "log-webhook-deploy", stageId: "webhook-change", offsetMs: 120_000, timestamp: "2026-06-25T16:12:00.000Z", level: "info", service: "release-controller", message: "Webhook worker deployment completed", traceId: "trace-deploy-5180", spanId: "span-deploy-complete", attributes: [{ key: "version", value: "5.18.0" }, { key: "replicas", value: 48 }] },
    { id: "log-webhook-poison", stageId: "webhook-impact", offsetMs: 331_000, timestamp: "2026-06-25T16:15:31.000Z", level: "error", service: "webhook-worker", message: "Delivery processing failed; scheduling retry", traceId: "trace-webhook-c4b8", spanId: "span-webhook-decode", attributes: [{ key: "message_id", value: "wh_msg_demo_1042" }, { key: "attempt", value: 4_812 }, { key: "partition", value: 17 }] },
    { id: "log-webhook-quarantine", stageId: "webhook-mitigation", offsetMs: 960_000, timestamp: "2026-06-25T16:26:00.000Z", level: "warn", service: "queue-operator", message: "Poison messages moved to quarantine", traceId: "trace-queue-remediation", spanId: "span-dlq-move", attributes: [{ key: "messages", value: 6 }, { key: "partitions_unblocked", value: 6 }] },
  ],
  waterfallSpans: [
    { id: "span-webhook-consume", parentId: null, traceId: "trace-webhook-c4b8", service: "webhook-worker", operation: "consume partition 17", startOffsetMs: 324_000, durationMs: 142, status: "error", attributes: [{ key: "message_id", value: "wh_msg_demo_1042" }] },
    { id: "span-webhook-decode", parentId: "span-webhook-consume", traceId: "trace-webhook-c4b8", service: "webhook-worker", operation: "decode envelope", startOffsetMs: 324_012, durationMs: 8, status: "error", attributes: [{ key: "schema_version", value: "2026-05" }] },
    { id: "span-webhook-requeue", parentId: "span-webhook-consume", traceId: "trace-webhook-c4b8", service: "event-queue", operation: "NACK requeue", startOffsetMs: 324_025, durationMs: 102, status: "ok", attributes: [{ key: "retry_delay_ms", value: 0 }] },
  ],
  replayFrames: [
    { id: "replay-webhook-queue", stageId: "webhook-impact", offsetMs: 331_000, route: "/operations/webhooks", title: "Queue lag alert", description: "The operations view highlights six stalled queue partitions.", cursorX: 1088, cursorY: 242, viewportWidth: 1440, viewportHeight: 900, highlightedSelector: "[data-metric='oldest-message-age']" },
    { id: "replay-webhook-message", stageId: "webhook-diagnosis", offsetMs: 662_000, route: "/operations/webhooks/partitions/17", title: "Repeated message found", description: "The same fictional message appears in every recent retry.", cursorX: 782, cursorY: 486, viewportWidth: 1440, viewportHeight: 900, highlightedSelector: "[data-message-id='wh_msg_demo_1042']" },
  ],
  change: {
    deployment: { id: "dep-webhook-5180", environment: "production", service: "webhook-worker", version: "5.18.0", startedAt: "2026-06-25T16:11:10.000Z", completedAt: "2026-06-25T16:12:00.000Z", status: "rolled-back" },
    configChanges: [{ key: "webhooks.worker.maxTerminalAttempts", previousValue: "10", nextValue: "unbounded", changedAt: "2026-06-25T16:12:00.000Z", changedBy: "release-controller" }],
    featureFlags: [{ key: "webhook-envelope-parser-v2", previousVariant: "legacy", currentVariant: "v2", rolloutPercent: 100, changedAt: "2026-06-25T16:12:00.000Z" }],
  },
  suspect: {
    commitSha: "c4b87dd",
    commitTitle: "Consolidate webhook envelope errors",
    pullRequestNumber: 4256,
    pullRequestTitle: "Refactor delivery worker parser",
    author: "Avery Singh",
    owner: "Event Delivery",
    mergedAt: "2026-06-25T15:28:00.000Z",
    changedLines: [
      { file: "src/worker/envelope-parser.ts", startLine: 78, endLine: 101, summary: "Maps validation failures to a retryable parser error." },
      { file: "src/worker/delivery-loop.ts", startLine: 151, endLine: 174, summary: "Requeues all parser errors without an attempt ceiling." },
    ],
  },
  rootCauseEvidence: [
    { id: "rc-webhook-head", stageId: "webhook-diagnosis", signal: "Partition-head repetition", explanation: "Six stalled partitions repeatedly process one malformed message each without advancing offsets.", confidence: 0.99, supportingEvidenceIds: ["log-webhook-poison", "span-webhook-decode"] },
    { id: "rc-webhook-diff", stageId: "webhook-diagnosis", signal: "Error classification regression", explanation: "The deployment changed schema failures from terminal to retryable and removed the attempt ceiling.", confidence: 0.97, supportingEvidenceIds: ["err-webhook-schema", "log-webhook-deploy"] },
  ],
  remediationActions: [
    { id: "rem-webhook-quarantine", title: "Quarantine poison messages", owner: "Event Delivery", status: "completed", completedAt: "2026-06-25T16:26:00.000Z", details: "Moved six malformed messages to a durable dead-letter queue." },
    { id: "rem-webhook-ceiling", title: "Enforce terminal retry ceiling", owner: "Event Delivery", status: "in-progress", completedAt: null, details: "Classifies schema errors as terminal and caps all retryable failures." },
  ],
  slo: { objective: "Webhooks delivered within 60 seconds", targetPercent: 99.9, windowDays: 30, observedPercent: 99.72, burnRate: 11.8, budgetRemainingBeforePercent: 78.1, budgetRemainingCurrentPercent: 65.4, projectedMinutesToExhaustion: 188 },
  topology: {
    nodes: [
      { id: "event-api", label: "Event API", kind: "service", health: "healthy", requestRate: 42_400, errorRatePercent: 0.1, latencyP95Ms: 72 },
      { id: "event-queue", label: "Event Queue", kind: "queue", health: "critical", requestRate: 42_300, errorRatePercent: 0, latencyP95Ms: 1_260_000 },
      { id: "webhook-worker", label: "Webhook Worker", kind: "service", health: "critical", requestRate: 91_200, errorRatePercent: 94.4, latencyP95Ms: 142 },
      { id: "merchant-endpoint", label: "Merchant Endpoints", kind: "provider", health: "healthy", requestRate: 5_100, errorRatePercent: 0.8, latencyP95Ms: 310 },
    ],
    edges: [
      { id: "edge-api-queue", source: "event-api", target: "event-queue", protocol: "queue", health: "healthy", requestsPerMinute: 42_300 },
      { id: "edge-queue-worker", source: "event-queue", target: "webhook-worker", protocol: "queue", health: "critical", requestsPerMinute: 91_200 },
      { id: "edge-worker-merchant", source: "webhook-worker", target: "merchant-endpoint", protocol: "HTTPS", health: "degraded", requestsPerMinute: 5_100 },
    ],
  },
};

const aiRefundStory: IncidentStory = {
  id: "ai-agent-wrong-refund",
  title: "Support agent issued incorrect refunds after tool prompt change",
  shortTitle: "AI refund error",
  severity: "SEV-2",
  status: "resolved",
  startedAt: "2026-06-29T11:05:00.000Z",
  resolvedAt: "2026-06-29T11:21:00.000Z",
  durationMs: 960_000,
  summary: "A prompt and tool-schema change made a support agent treat store credit amounts as cash refund amounts.",
  userImpact: "Twenty-seven fictional customers received incorrect cash refunds instead of the intended store credit.",
  businessImpact: "$8,640 in excess refunds was issued and automatically flagged for finance review.",
  affectedUsers: 27,
  affectedRegion: "English-language support queue",
  metrics: [
    { id: "ai-refund-errors", label: "Incorrect refund decisions", unit: "count", higherIsWorse: true, baseline: 0, current: 27, recovered: 0 },
    { id: "ai-tool-confidence", label: "Tool-call confidence", unit: "percent", higherIsWorse: false, baseline: 96.2, current: 61.4, recovered: 97.1 },
    { id: "ai-refund-value", label: "Refund value at risk", unit: "dollars", higherIsWorse: true, baseline: 0, current: 8_640, recovered: 0 },
  ],
  stages: [
    { id: "ai-healthy", kind: "healthy", offsetMs: 0, title: "Agent healthy", summary: "Refund policy checks and tool arguments agree.", metricValues: [{ metricId: "ai-refund-errors", value: 0 }, { metricId: "ai-tool-confidence", value: 96.2 }], evidenceIds: [] },
    { id: "ai-change", kind: "change", offsetMs: 75_000, title: "Prompt and tool v7 deployed", summary: "Refund instructions are condensed and credit_amount is renamed amount.", metricValues: [{ metricId: "ai-refund-errors", value: 0 }, { metricId: "ai-tool-confidence", value: 93.1 }], evidenceIds: ["log-ai-deploy"] },
    { id: "ai-impact", kind: "impact", offsetMs: 180_000, title: "Wrong refund issued", summary: "The agent submits a cash refund using a store-credit recommendation.", metricValues: [{ metricId: "ai-refund-errors", value: 27 }, { metricId: "ai-tool-confidence", value: 61.4 }], evidenceIds: ["err-ai-policy", "span-ai-refund-tool", "replay-ai-tool"] },
    { id: "ai-diagnosis", kind: "diagnosis", offsetMs: 390_000, title: "Semantic mismatch identified", summary: "AI evaluation traces the decision to ambiguous prompt language and tool naming.", metricValues: [{ metricId: "ai-refund-errors", value: 27 }, { metricId: "ai-tool-confidence", value: 64.8 }], evidenceIds: ["rc-ai-prompt", "rc-ai-tool"] },
    { id: "ai-mitigation", kind: "mitigation", offsetMs: 600_000, title: "Autonomous refunds paused", summary: "Refund execution requires human confirmation while prompt v6 is restored.", metricValues: [{ metricId: "ai-refund-errors", value: 27 }, { metricId: "ai-tool-confidence", value: 88.9 }], evidenceIds: ["log-ai-disable"] },
    { id: "ai-recovery", kind: "recovery", offsetMs: 900_000, title: "Agent recovered", summary: "Corrected prompt and typed tool fields pass shadow evaluation.", metricValues: [{ metricId: "ai-refund-errors", value: 0 }, { metricId: "ai-tool-confidence", value: 97.1 }], evidenceIds: [] },
  ],
  errors: [{
    id: "err-ai-policy",
    stageId: "ai-impact",
    fingerprint: "support-agent-refund-policy-mismatch",
    title: "RefundPolicyMismatch",
    message: "Cash refund amount exceeded policy recommendation for this support case.",
    count: 27,
    affectedUsers: 27,
    traceId: "trace-ai-f39a",
    spanId: "span-ai-refund-tool",
    stackFrames: [
      { functionName: "validateRefundDecision", file: "src/agent/policy/refund-policy.ts", line: 133, column: 18, inApplication: true },
      { functionName: "executeRefundTool", file: "src/agent/tools/refund.ts", line: 89, column: 14, inApplication: true },
      { functionName: "runSupportTurn", file: "src/agent/runtime.ts", line: 211, column: 20, inApplication: true },
    ],
    breadcrumbs: [
      { offsetMs: 172_000, category: "ai", message: "Model recommended 320 credits", level: "info" },
      { offsetMs: 173_200, category: "ai", message: "Tool argument amount=320 currency=USD", level: "warning" },
      { offsetMs: 174_000, category: "http", message: "Refund provider accepted $320.00", level: "error" },
    ],
  }],
  logs: [
    { id: "log-ai-deploy", stageId: "ai-change", offsetMs: 75_000, timestamp: "2026-06-29T11:06:15.000Z", level: "info", service: "agent-orchestrator", message: "Support agent definition activated", traceId: "trace-agent-deploy-v7", spanId: "span-agent-activate", attributes: [{ key: "prompt_version", value: "refund-v7" }, { key: "tool_schema", value: "refund-tool-v7" }, { key: "model", value: "fictional-support-model-2" }] },
    { id: "log-ai-tool", stageId: "ai-impact", offsetMs: 174_000, timestamp: "2026-06-29T11:07:54.000Z", level: "error", service: "refund-service", message: "Refund policy post-check failed", traceId: "trace-ai-f39a", spanId: "span-ai-refund-tool", attributes: [{ key: "recommended_instrument", value: "store_credit" }, { key: "executed_instrument", value: "cash" }, { key: "amount", value: 320 }] },
    { id: "log-ai-disable", stageId: "ai-mitigation", offsetMs: 600_000, timestamp: "2026-06-29T11:15:00.000Z", level: "warn", service: "agent-orchestrator", message: "Autonomous refund tool disabled", traceId: "trace-agent-mitigation", spanId: "span-flag-write", attributes: [{ key: "flag", value: "support-agent-auto-refund" }, { key: "rollout_percent", value: 0 }] },
  ],
  waterfallSpans: [
    { id: "span-ai-turn", parentId: null, traceId: "trace-ai-f39a", service: "agent-orchestrator", operation: "support turn", startOffsetMs: 170_000, durationMs: 4_860, status: "error", attributes: [{ key: "prompt_version", value: "refund-v7" }] },
    { id: "span-ai-model", parentId: "span-ai-turn", traceId: "trace-ai-f39a", service: "fictional-support-model-2", operation: "generate response", startOffsetMs: 170_120, durationMs: 2_980, status: "ok", attributes: [{ key: "finish_reason", value: "tool_call" }] },
    { id: "span-ai-refund-tool", parentId: "span-ai-turn", traceId: "trace-ai-f39a", service: "refund-service", operation: "issue_refund", startOffsetMs: 173_200, durationMs: 800, status: "error", attributes: [{ key: "amount", value: 320 }, { key: "instrument", value: "cash" }] },
  ],
  replayFrames: [
    { id: "replay-ai-recommendation", stageId: "ai-impact", offsetMs: 172_000, route: "/support/cases/demo-204", title: "Credit recommended", description: "The agent correctly reasons that the fictional customer qualifies for store credit.", cursorX: 980, cursorY: 412, viewportWidth: 1440, viewportHeight: 900, highlightedSelector: "[data-agent-step='recommendation']" },
    { id: "replay-ai-tool", stageId: "ai-impact", offsetMs: 173_200, route: "/support/cases/demo-204", title: "Cash refund tool called", description: "The tool preview shows an ambiguous amount field and cash instrument.", cursorX: 1014, cursorY: 588, viewportWidth: 1440, viewportHeight: 900, highlightedSelector: "[data-tool-call='issue_refund']" },
  ],
  change: {
    deployment: { id: "dep-agent-refund-v7", environment: "production", service: "agent-orchestrator", version: "refund-v7", startedAt: "2026-06-29T11:05:50.000Z", completedAt: "2026-06-29T11:06:15.000Z", status: "rolled-back" },
    configChanges: [
      { key: "agents.support.refundPrompt", previousValue: "refund-v6", nextValue: "refund-v7", changedAt: "2026-06-29T11:06:15.000Z", changedBy: "agent-release-bot" },
      { key: "agents.support.refundToolSchema", previousValue: "refund-tool-v6", nextValue: "refund-tool-v7", changedAt: "2026-06-29T11:06:15.000Z", changedBy: "agent-release-bot" },
    ],
    featureFlags: [{ key: "support-agent-auto-refund", previousVariant: "prompt-v6", currentVariant: "prompt-v7", rolloutPercent: 100, changedAt: "2026-06-29T11:06:15.000Z" }],
  },
  suspect: {
    commitSha: "f39aa62",
    commitTitle: "Condense refund instructions and tool schema",
    pullRequestNumber: 4294,
    pullRequestTitle: "Reduce support agent refund latency",
    author: "Nora Reyes",
    owner: "AI Support Systems",
    mergedAt: "2026-06-29T10:32:00.000Z",
    changedLines: [
      { file: "prompts/support/refund-v7.md", startLine: 22, endLine: 38, summary: "Combines cash refund and store-credit instructions into one amount rule." },
      { file: "src/agent/tools/refund-schema.ts", startLine: 41, endLine: 59, summary: "Renames credit_amount to amount without retaining instrument semantics." },
    ],
  },
  rootCauseEvidence: [
    { id: "rc-ai-prompt", stageId: "ai-diagnosis", signal: "Counterfactual prompt evaluation", explanation: "Replaying the same cases with prompt v6 selects store credit in 100% of affected traces.", confidence: 0.97, supportingEvidenceIds: ["log-ai-deploy", "err-ai-policy"] },
    { id: "rc-ai-tool", stageId: "ai-diagnosis", signal: "Argument semantic mismatch", explanation: "The model copied the store-credit quantity into the newly generic cash amount field.", confidence: 0.95, supportingEvidenceIds: ["span-ai-refund-tool", "log-ai-tool"] },
  ],
  remediationActions: [
    { id: "rem-ai-disable", title: "Require refund confirmation", owner: "AI Support Systems", status: "completed", completedAt: "2026-06-29T11:15:00.000Z", details: "Disabled autonomous execution and restored prompt v6." },
    { id: "rem-ai-schema", title: "Split cash and credit tool fields", owner: "Support Platform", status: "in-progress", completedAt: null, details: "Uses distinct instrument-specific amounts with policy validation before execution." },
    { id: "rem-ai-eval", title: "Add refund counterfactual evaluation", owner: "AI Quality", status: "planned", completedAt: null, details: "Blocks prompt releases that change the selected refund instrument." },
  ],
  slo: { objective: "Policy-compliant autonomous support actions", targetPercent: 99.99, windowDays: 30, observedPercent: 99.91, burnRate: 9.1, budgetRemainingBeforePercent: 88.4, budgetRemainingCurrentPercent: 79.3, projectedMinutesToExhaustion: 264 },
  topology: {
    nodes: [
      { id: "support-ui", label: "Support Console", kind: "edge", health: "healthy", requestRate: 2_400, errorRatePercent: 0.2, latencyP95Ms: 210 },
      { id: "agent-orchestrator", label: "Agent Orchestrator", kind: "service", health: "degraded", requestRate: 1_820, errorRatePercent: 1.5, latencyP95Ms: 5_200 },
      { id: "support-model", label: "Support Model", kind: "ai-model", health: "degraded", requestRate: 1_810, errorRatePercent: 0, latencyP95Ms: 3_100 },
      { id: "refund-service", label: "Refund Service", kind: "service", health: "critical", requestRate: 180, errorRatePercent: 15, latencyP95Ms: 920 },
      { id: "payment-ledger", label: "Payment Ledger", kind: "database", health: "healthy", requestRate: 178, errorRatePercent: 0.1, latencyP95Ms: 65 },
    ],
    edges: [
      { id: "edge-ui-agent", source: "support-ui", target: "agent-orchestrator", protocol: "HTTPS", health: "healthy", requestsPerMinute: 1_820 },
      { id: "edge-agent-model", source: "agent-orchestrator", target: "support-model", protocol: "HTTPS", health: "degraded", requestsPerMinute: 1_810 },
      { id: "edge-agent-refund", source: "agent-orchestrator", target: "refund-service", protocol: "tool-call", health: "critical", requestsPerMinute: 180 },
      { id: "edge-refund-ledger", source: "refund-service", target: "payment-ledger", protocol: "SQL", health: "healthy", requestsPerMinute: 178 },
    ],
  },
};

export const INCIDENT_STORIES: [IncidentStory, ...IncidentStory[]] = [
  safariStory,
  mfaStory,
  webhookStory,
  aiRefundStory,
];
