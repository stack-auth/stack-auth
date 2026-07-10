export type PlanTier = "free" | "starter" | "growth" | "enterprise";

export type CellState =
  | "healthy"
  | "deploying"
  | "degraded"
  | "isolating"
  | "failing_over"
  | "protected"
  | "recovering"
  | "pinned";

export type Tenant = {
  id: string,
  name: string,
  plan: PlanTier,
  arrUsd: number,
  userCount: number,
  residency: string,
};

export type RecoveryPolicy = {
  mode: "warm-standby" | "cold" | "active-active",
  standbyProvider: string,
  standbyRegion: string,
  rpoSeconds: number,
  rtoSeconds: number,
};

export type TenantCell = {
  id: string,
  tenantId: string,
  state: CellState,
  releaseVersion: string,
  dbBranchId: string,
  regionId: string,
  provider: string,
  recovery: RecoveryPolicy,
  replicationLagMs: number,
  lastHealthyAt: string,
};

export type RolloutStageStatus = "pending" | "running" | "healthy" | "paused" | "skipped" | "complete";

export type RolloutStage = {
  id: string,
  label: string,
  segment: string,
  users: number,
  orgs: number,
  arrUsd: number,
  status: RolloutStageStatus,
  healthGate: "waiting" | "passing" | "failing" | "blocked",
};

export type ReleaseCommit = {
  sha: string,
  message: string,
  author: string,
};

export type FeatureFlag = {
  id: string,
  name: string,
  description: string,
};

export type Release = {
  id: string,
  version: string,
  title: string,
  status: "draft" | "rolling_out" | "paused" | "complete" | "rolled_back",
  commits: ReleaseCommit[],
  migrationCount: number,
  featureFlags: FeatureFlag[],
  blastRadiusUsers: number,
  blastRadiusArrUsd: number,
  versionWindow: { from: string, to: string },
  stages: RolloutStage[],
  buildLog: BuildLogLine[],
  framework: "Next.js" | "Vite" | "Remix",
  connectedRepo: string,
};

export type BuildLogLine = {
  id: string,
  step: "install" | "build" | "deploy" | "check",
  text: string,
  delayMs: number,
  level?: "info" | "success" | "warn",
};

export type SensitiveKind = "email" | "name" | "phone" | "freetext" | "ssn" | "address";

export type SchemaColumn = {
  name: string,
  type: string,
  nullable: boolean,
  sensitive?: { kind: SensitiveKind },
};

export type SchemaTable = {
  name: string,
  columns: SchemaColumn[],
};

export type DbBranch = {
  id: string,
  name: string,
  parentId: string | null,
  kind: "production" | "preview" | "dev" | "forensic" | "clone",
  releaseVersion?: string,
  previewUrl?: string,
  sizeGb: number,
  createdAt: string,
};

export type MigrationStepKind = "expand" | "contract";

export type MigrationStep = {
  id: string,
  kind: MigrationStepKind,
  sql: string,
  plainLabel: string,
  heldBy?: string,
  status: "applied" | "queued" | "deferred" | "released",
};

export type BlastRadius = {
  nullRows: number,
  orgsAffected: number,
  enterpriseOrgs: number,
  arrUsd: number,
  plainSummary: string,
  predictedOutcome: string,
  recommendedSequence: string[],
};

export type Migration = {
  id: string,
  releaseVersion: string,
  orm: "prisma" | "drizzle",
  title: string,
  steps: MigrationStep[],
  beforeDiff: string,
  afterDiff: string,
  blastRadius: BlastRadius,
  lockWarning?: string,
};

export type CompatVerdict = "green" | "amber" | "red";

export type CompatMatrix = {
  versions: string[],
  schemaStates: string[],
  cells: CompatVerdict[][],
  activeWindow: { from: string, to: string },
  headline: string,
};

export type ClonePreset = {
  id: string,
  targetSizeLabel: string,
  targetSizeGb: number,
  orgsPreserved: number,
  enterpriseOrgs: number,
  coverageNotes: string[],
  redactionReport: { field: string, kind: SensitiveKind, example: string }[],
};

export type DbReplicaRole = "primary" | "sync-replica" | "async-replica" | "standby";

export type DbReplica = {
  id: string,
  role: DbReplicaRole,
  provider: string,
  region: string,
  lagMs: number,
  state: "live" | "catching-up" | "paused",
  promotable: boolean,
};

export type DbPointInTimeRecovery = {
  retentionDays: number,
  oldestRestorePoint: string,
  lastSnapshotAt: string,
  walArchiveLagSeconds: number,
};

export type SlowQuery = {
  id: string,
  sql: string,
  p95Ms: number,
  callsPerMin: number,
  suggestedIndex: string,
  plainHint: string,
};

export type ContinuumRegion = {
  id: string,
  label: string,
  provider: string,
  x: number,
  y: number,
};

export type ContinuumMapEdge = {
  id: string,
  source: string,
  target: string,
  kind: "traffic" | "replication" | "failover",
  health: "healthy" | "degraded" | "critical" | "active",
  label?: string,
};

export type ContinuumMapNode = {
  id: string,
  label: string,
  kind: "customer" | "cell" | "release" | "database" | "region" | "provider",
  x: number,
  y: number,
  health: "healthy" | "degraded" | "critical" | "protected" | "pinned",
  subtitle?: string,
};

export type IncidentGate = {
  actionLabel: string,
  preview: string,
};

export type IncidentStageOverride = {
  cellStates?: Partial<Record<string, CellState>>,
  edgeHealth?: Partial<Record<string, ContinuumMapEdge["health"]>>,
  metrics?: { id: string, value: number }[],
  logLines?: string[],
};

export type ContinuumIncidentStage = {
  id: string,
  act: 1 | 2 | 3 | 4 | 5,
  offsetMs: number,
  title: string,
  summary: string,
  overrides: IncidentStageOverride,
  gate?: IncidentGate,
};

export type ContinuumIncidentStory = {
  id: string,
  title: string,
  durationMs: number,
  stages: ContinuumIncidentStage[],
  closingCard: {
    title: string,
    bullets: string[],
    avoidedDowntimeMinutes: number,
    protectedArrUsd: number,
  },
};

export type CopilotTurn = {
  id: string,
  role: "agent" | "system",
  text: string,
  delayMs: number,
  approval?: {
    id: string,
    title: string,
    detail: string,
    expiresInMinutes: number,
  },
};

export type PlatformRuntimeLog = {
  id: string,
  level: "info" | "warn" | "error",
  route: string,
  deployment: string,
  message: string,
  at: string,
};

export type PlatformFunction = {
  id: string,
  name: string,
  kind: "serverless" | "edge" | "middleware",
  invocations: number,
  errors: number,
  p99Ms: number,
  coldStarts: number,
};

export type PlatformCron = {
  id: string,
  name: string,
  schedule: string,
  lastStatus: "ok" | "failed" | "skipped",
  lastRunAt: string,
};

export type PlatformDomain = {
  id: string,
  hostname: string,
  ssl: "active" | "pending",
  dns: { type: string, name: string, value: string }[],
};

export type PlatformEnvVar = {
  id: string,
  key: string,
  environments: ("dev" | "preview" | "prod")[],
  encrypted: boolean,
  branchOverride?: string,
};

export type PlatformFirewallEvent = {
  id: string,
  kind: "challenge" | "bot" | "blocked",
  count: number,
  country: string,
};

export type PlatformAnalytics = {
  visitors: number,
  pageViews: number,
  topReferrers: { source: string, views: number }[],
  topCountries: { country: string, views: number }[],
};

export type PlatformSpeedInsight = {
  route: string,
  lcp: number,
  cls: number,
  inp: number,
  score: "good" | "needs-improvement" | "poor",
};

export type PlatformUsage = {
  bandwidthGb: number,
  functionInvocations: number,
  buildMinutes: number,
  projectedBillUsd: number,
  spendCapUsd: number,
};
