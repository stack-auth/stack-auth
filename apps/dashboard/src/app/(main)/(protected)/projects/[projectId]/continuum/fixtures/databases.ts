import type {
  ClonePreset,
  CompatMatrix,
  DbBranch,
  DbPointInTimeRecovery,
  DbReplica,
  Migration,
  SchemaTable,
  SlowQuery,
} from "./types";

export const DB_BRANCHES: DbBranch[] = [
  { id: "db-prod", name: "production", parentId: null, kind: "production", releaseVersion: "v1.0.46–47", sizeGb: 2_048, createdAt: "2024-01-12T00:00:00.000Z" },
  { id: "db-prod-eu", name: "production-eu", parentId: null, kind: "production", releaseVersion: "v1.0.46–47", sizeGb: 410, createdAt: "2024-03-01T00:00:00.000Z" },
  { id: "db-preview-pricing", name: "feat-pricing", parentId: "db-prod", kind: "preview", releaseVersion: "preview", previewUrl: "feat-pricing--acme.hexclave.app", sizeGb: 12, createdAt: "2026-07-08T14:00:00.000Z" },
  { id: "db-dev-maya", name: "dev/maya", parentId: "db-prod", kind: "dev", sizeGb: 5, createdAt: "2026-07-09T09:00:00.000Z" },
  { id: "db-clone-5gb", name: "clone/5gb-sample", parentId: "db-prod", kind: "clone", sizeGb: 5, createdAt: "2026-07-10T11:00:00.000Z" },
];

export const DB_REPLICAS: DbReplica[] = [
  { id: "rep-primary", role: "primary", provider: "AWS", region: "us-east-1", lagMs: 0, state: "live", promotable: false },
  { id: "rep-sync", role: "sync-replica", provider: "AWS", region: "us-east-2", lagMs: 3, state: "live", promotable: true },
  { id: "rep-async-eu", role: "async-replica", provider: "AWS", region: "eu-west-1", lagMs: 96, state: "live", promotable: true },
  { id: "rep-standby-gcp", role: "standby", provider: "GCP", region: "us-central1", lagMs: 42, state: "live", promotable: true },
];

export const DB_PITR: DbPointInTimeRecovery = {
  retentionDays: 14,
  oldestRestorePoint: "2026-06-26T11:00:00.000Z",
  lastSnapshotAt: "2026-07-10T18:30:00.000Z",
  walArchiveLagSeconds: 4,
};

export const SCHEMA_TABLES: SchemaTable[] = [
  {
    name: "users",
    columns: [
      { name: "id", type: "uuid", nullable: false },
      { name: "email", type: "text", nullable: true, sensitive: { kind: "email" } },
      { name: "full_name", type: "text", nullable: true, sensitive: { kind: "name" } },
      { name: "phone", type: "text", nullable: true, sensitive: { kind: "phone" } },
      { name: "notes", type: "text", nullable: true, sensitive: { kind: "freetext" } },
      { name: "organization_id", type: "uuid", nullable: false },
      { name: "legacy_role", type: "text", nullable: true },
      { name: "role_id", type: "uuid", nullable: true },
      { name: "created_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "organizations",
    columns: [
      { name: "id", type: "uuid", nullable: false },
      { name: "name", type: "text", nullable: false, sensitive: { kind: "name" } },
      { name: "plan", type: "text", nullable: false },
      { name: "billing_email", type: "text", nullable: true, sensitive: { kind: "email" } },
    ],
  },
  {
    name: "organization_roles",
    columns: [
      { name: "id", type: "uuid", nullable: false },
      { name: "organization_id", type: "uuid", nullable: false },
      { name: "name", type: "text", nullable: false },
      { name: "permissions", type: "jsonb", nullable: false },
    ],
  },
  {
    name: "invitations",
    columns: [
      { name: "id", type: "uuid", nullable: false },
      { name: "email", type: "text", nullable: false, sensitive: { kind: "email" } },
      { name: "organization_id", type: "uuid", nullable: false },
      { name: "role_id", type: "uuid", nullable: true },
      { name: "status", type: "text", nullable: false },
    ],
  },
];

export const MIGRATIONS: Migration[] = [
  {
    id: "mig-roles-147",
    releaseVersion: "v1.0.47",
    orm: "prisma",
    title: "organization_roles + invitations.role_id",
    steps: [
      {
        id: "step-expand-table",
        kind: "expand",
        sql: "CREATE TABLE organization_roles (...);",
        plainLabel: "Add a new roles table (safe for old and new versions)",
        status: "applied",
      },
      {
        id: "step-expand-col",
        kind: "expand",
        sql: "ALTER TABLE users ADD COLUMN role_id uuid NULL;",
        plainLabel: "Add role_id column (nullable — old version ignores it)",
        status: "applied",
      },
      {
        id: "step-contract-drop",
        kind: "contract",
        sql: "ALTER TABLE users DROP COLUMN legacy_role;",
        plainLabel: "Remove the old role column",
        heldBy: "Atlas Health is still on the previous version",
        status: "deferred",
      },
    ],
    beforeDiff: `- model User {
-   legacy_role String?
- }`,
    afterDiff: `+ model OrganizationRole {
+   id             String
+   organizationId String
+   name           String
+   permissions    Json
+ }
+ model User {
+   roleId String?
+ }`,
    blastRadius: {
      nullRows: 1_842,
      orgsAffected: 37,
      enterpriseOrgs: 4,
      arrUsd: 92_400,
      plainSummary: "1,842 users have a null email, spread across 37 orgs (4 enterprise, $92,400 ARR).",
      predictedOutcome: "The previous app version still writes nulls during SSO provisioning. Predicted outcome: SSO sign-in failures for 12% of enterprise users.",
      recommendedSequence: [
        "Deploy a compat release that stops writing nulls",
        "Backfill missing emails",
        "Validate zero nulls remain",
        "Apply the NOT NULL constraint",
      ],
    },
    lockWarning: "DROP COLUMN waits for open transactions — held until the version window closes.",
  },
];

export const COMPAT_MATRIX: CompatMatrix = {
  versions: ["v1.0.45", "v1.0.46", "v1.0.47"],
  // Column headers for the compat grid — plain labels for the three database shapes
  // a release moves through: before the safe additions, while both app versions share
  // the database, and after old columns are cleaned up.
  schemaStates: ["Before update", "Both versions", "After cleanup"],
  cells: [
    ["green", "green", "red"],
    ["amber", "green", "red"],
    ["red", "green", "green"],
  ],
  activeWindow: { from: "v1.0.46", to: "v1.0.47" },
  headline: "Your database works with both the current and previous version — safe to undo anytime ✓",
};

export const CLONE_PRESETS: ClonePreset[] = [
  {
    id: "clone-1gb",
    targetSizeLabel: "1 GB",
    targetSizeGb: 1,
    orgsPreserved: 84,
    enterpriseOrgs: 1,
    coverageNotes: ["All schema shapes covered", "Rare enum values included"],
    redactionReport: [
      { field: "users.email", kind: "email", example: "alex.rivera@example.com" },
      { field: "users.full_name", kind: "name", example: "Alex Rivera" },
      { field: "users.notes", kind: "freetext", example: "[scrubbed]" },
    ],
  },
  {
    id: "clone-5gb",
    targetSizeLabel: "5 GB",
    targetSizeGb: 5,
    orgsPreserved: 412,
    enterpriseOrgs: 6,
    coverageNotes: ["All schema shapes covered", "Rare enum values included", "Invite + role edge cases preserved"],
    redactionReport: [
      { field: "users.email", kind: "email", example: "sam.chen@example.com" },
      { field: "users.full_name", kind: "name", example: "Sam Chen" },
      { field: "users.phone", kind: "phone", example: "+1-555-0142" },
      { field: "users.notes", kind: "freetext", example: "[scrubbed]" },
      { field: "organizations.billing_email", kind: "email", example: "billing@example.org" },
    ],
  },
  {
    id: "clone-50gb",
    targetSizeLabel: "50 GB",
    targetSizeGb: 50,
    orgsPreserved: 3_840,
    enterpriseOrgs: 28,
    coverageNotes: ["Statistically representative", "Whole tenants kept together"],
    redactionReport: [
      { field: "users.email", kind: "email", example: "jordan.lee@example.com" },
      { field: "users.full_name", kind: "name", example: "Jordan Lee" },
      { field: "users.notes", kind: "freetext", example: "[scrubbed]" },
    ],
  },
  {
    id: "clone-full",
    targetSizeLabel: "Full (2 TB)",
    targetSizeGb: 2_048,
    orgsPreserved: 12_400,
    enterpriseOrgs: 86,
    coverageNotes: ["Complete production copy", "Anonymized end-to-end"],
    redactionReport: [
      { field: "users.email", kind: "email", example: "taylor.ng@example.com" },
      { field: "users.full_name", kind: "name", example: "Taylor Ng" },
      { field: "users.notes", kind: "freetext", example: "[scrubbed]" },
    ],
  },
];

export const SLOW_QUERIES: SlowQuery[] = [
  {
    id: "sq-1",
    sql: "SELECT * FROM invitations WHERE organization_id = $1 AND status = 'pending'",
    p95Ms: 840,
    callsPerMin: 1_240,
    suggestedIndex: "CREATE INDEX invitations_org_status_idx ON invitations (organization_id, status);",
    plainHint: "Invites for large orgs are scanning the whole table. An index on org + status would fix it.",
  },
  {
    id: "sq-2",
    sql: "SELECT u.* FROM users u JOIN organization_roles r ON u.role_id = r.id WHERE r.name = $1",
    p95Ms: 420,
    callsPerMin: 380,
    suggestedIndex: "CREATE INDEX users_role_id_idx ON users (role_id);",
    plainHint: "Looking up users by role is slower than it should be after the new roles table landed.",
  },
];

export const AUTOSCALING_SAMPLES = [
  { t: 0, cpu: 22, connections: 180 },
  { t: 1, cpu: 28, connections: 210 },
  { t: 2, cpu: 41, connections: 290 },
  { t: 3, cpu: 55, connections: 360 },
  { t: 4, cpu: 48, connections: 340 },
  { t: 5, cpu: 36, connections: 260 },
  { t: 6, cpu: 30, connections: 220 },
] as const;

export const DEFERRED_CLEANUP_CAPTION =
  "One cleanup step is waiting until everyone's on the new version (Atlas Health is still on the old one).";
