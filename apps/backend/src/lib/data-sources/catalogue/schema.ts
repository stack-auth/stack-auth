import { z } from "zod";

const nullableString = z.string().nullable();

export const authTierSchema = z.enum(["T1_SIMPLE", "T2_BYO_APP", "T3_BYO_REFRESH"]);
export type AuthTier = z.infer<typeof authTierSchema>;

export const connectorCategorySchema = z.enum([
  "payments", "crm", "marketing", "support", "product", "engineering",
  "hr", "finance", "analytics", "database", "files", "streaming", "other",
]);
export type ConnectorCategory = z.infer<typeof connectorCategorySchema>;

export const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("interval"), seconds: z.number().int().positive() }).passthrough(),
  z.object({ kind: z.literal("cron"), expr: z.string() }).passthrough(),
  z.object({ kind: z.literal("continuous") }).passthrough(),
  z.object({ kind: z.literal("other"), literal: z.string(), description: z.string() }).passthrough(),
]);
export type ConnectorSchedule = z.infer<typeof scheduleSchema>;

const baseUrlSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.string() }).passthrough(),
  z.object({
    kind: z.literal("template"),
    template: z.string(),
    placeholders: z.record(z.string()),
  }).passthrough(),
  z.object({ kind: z.literal("resolved"), resolution: z.string() }).passthrough(),
]);

const transportSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("http"),
    baseUrl: baseUrlSchema.nullable(),
    defaultHeaders: z.record(z.string()).nullable(),
    apiVersionPinning: nullableString,
  }).passthrough(),
  z.object({
    kind: z.literal("sql"),
    engine: z.enum(["postgres", "mysql", "sqlserver", "oracle", "bigquery", "redshift", "db2", "snowflake", "mongodb"]),
    defaultPort: z.number().int().nullable(),
    sslPolicy: nullableString,
    tunnelSupport: nullableString,
  }).passthrough(),
  z.object({
    kind: z.literal("objectStore"),
    store: z.enum(["s3", "gcs", "azure_blob", "sftp", "sharepoint", "drive", "https"]),
  }).passthrough(),
  z.object({
    kind: z.literal("stream"),
    system: z.enum(["kafka", "kinesis", "pubsub", "sqs", "dynamodb", "firestore", "other"]),
    endpointConfig: nullableString,
  }).passthrough(),
  // One mined connector uses a vendor SDK rather than one of the protocol
  // transports anticipated by v2.1. Keeping the reported misfit losslessly is
  // more useful than coercing it into HTTP and pretending the runtime can run it.
  z.object({
    kind: z.literal("vendorSdk"),
    library: z.string(),
    protocol: z.string(),
    services: z.array(z.string()),
    baseUrl: z.null(),
    defaultHeaders: z.null(),
    apiVersionPinning: nullableString,
  }).passthrough(),
]);

export const connectorTransportSchema = z.object({
  role: z.enum(["primary", "sidecar"]),
  purpose: nullableString,
  spec: transportSpecSchema,
}).passthrough();
export type ConnectorTransport = z.infer<typeof connectorTransportSchema>;

const credentialSchemeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bearer"), field: z.string() }).passthrough(),
  z.object({ type: z.literal("header"), header: z.string(), field: z.string(), prefix: nullableString }).passthrough(),
  z.object({ type: z.literal("basic"), usernameField: z.string(), passwordField: z.string() }).passthrough(),
  z.object({ type: z.literal("query"), param: z.string(), field: z.string() }).passthrough(),
  z.object({
    type: z.literal("oauth2"),
    authUrl: nullableString,
    tokenUrl: nullableString,
    scopes: z.array(z.string()),
    grant: z.enum(["authorization_code", "refresh_token", "client_credentials"]),
  }).passthrough(),
  z.object({ type: z.literal("dsn"), fields: z.array(z.string()) }).passthrough(),
  z.object({ type: z.literal("cloudIam"), provider: z.string(), fields: z.array(z.string()) }).passthrough(),
  z.object({ type: z.literal("sasl"), mechanisms: z.array(z.string()) }).passthrough(),
  z.object({ type: z.literal("other"), description: z.string() }).passthrough(),
]);

export const credentialModeSchema = z.object({
  name: z.string(),
  appliesToTransport: z.enum(["primary", "sidecar"]),
  tier: authTierSchema,
  scheme: credentialSchemeSchema,
}).passthrough();
export type CredentialMode = z.infer<typeof credentialModeSchema>;

export const connectorConfigFieldSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  required: z.boolean(),
  secret: z.boolean(),
  // Eight early batches predate v2.1's endpoint/resource distinction. The
  // absence stays visible instead of being silently assigned to either scope.
  scope: z.enum(["endpoint", "resource"]).optional(),
  type: z.enum(["string", "date", "number", "boolean", "array", "object"]),
  description: nullableString,
}).passthrough();
export type ConnectorConfigField = z.infer<typeof connectorConfigFieldSchema>;

const paginatorBase = {
  tokenFrom: z.enum(["body", "header", "url_query", "url_path_segment", "last_record", "n/a"]).optional(),
  tokenTo: z.enum(["query_param", "header", "body_field", "path_segment", "full_url"]).optional(),
  terminateOn: z.enum(["envelope_flag", "short_page", "absent_token", "explicit_total"]).nullable().optional(),
  notes: z.string().optional(),
};

export const paginatorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).passthrough(),
  z.object({
    type: z.literal("offset"),
    limitParam: z.string().nullable(),
    offsetParam: z.string(),
    pageSize: z.number().int().positive(),
    ...paginatorBase,
  }).passthrough(),
  z.object({
    type: z.literal("page"),
    limitParam: z.string().nullable(),
    pageParam: z.string(),
    pageSize: z.number().int().positive().nullable(),
    startPage: z.number().int(),
    ...paginatorBase,
  }).passthrough(),
  z.object({
    type: z.literal("cursor"),
    cursorParam: z.string().nullable(),
    cursorPath: z.string(),
    hasMorePath: nullableString.optional(),
    pageSizeParam: nullableString.optional(),
    pageSize: z.number().int().positive().nullable().optional(),
    ...paginatorBase,
  }).passthrough(),
  z.object({
    type: z.literal("record_cursor"),
    param: z.string(),
    recordField: z.string(),
    hasMorePath: nullableString,
    pageSizeParam: nullableString.optional(),
    pageSize: z.number().int().positive().nullable().optional(),
    ...paginatorBase,
  }).passthrough(),
  z.object({ type: z.literal("next_url"), nextUrlPath: z.string(), ...paginatorBase }).passthrough(),
  z.object({
    type: z.literal("body_cursor"),
    cursorBodyKey: z.string(),
    cursorPath: z.string(),
    hasMorePath: nullableString,
    pageSizeParam: nullableString.optional(),
    pageSize: z.number().int().positive().nullable().optional(),
    ...paginatorBase,
  }).passthrough(),
]);
export type ConnectorPaginator = z.infer<typeof paginatorSchema>;

const incrementalParamSchema = z.object({
  param: z.string(),
  // `unix_milliseconds` was reported as a union misfit by two connectors and
  // is preserved here so the catalogue remains lossless.
  format: z.enum(["iso8601", "unix_seconds", "unix_milliseconds", "date"]),
}).passthrough().nullable();

const pullSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("http"),
    // Null is an explicit abstention in two mined pulls; capability evaluation
    // rejects it rather than inventing an endpoint.
    path: z.string().nullable(),
    httpMethod: z.enum(["GET", "POST"]),
    recordsPath: nullableString,
    params: z.record(z.unknown()).nullable(),
    pathPlaceholders: z.record(z.string()).nullable(),
    paginator: paginatorSchema.nullable(),
    incrementalParam: incrementalParamSchema,
  }).passthrough(),
  z.object({
    kind: z.literal("table"),
    schema: nullableString,
    table: nullableString,
    keyColumns: z.array(z.string()),
    cursorColumns: z.array(z.string()),
    querySketch: nullableString,
    chunking: nullableString.optional(),
  }).passthrough(),
  z.object({
    kind: z.literal("objects"),
    prefix: nullableString,
    matchExpr: nullableString,
    matchExprKind: z.enum(["glob", "regex"]).nullable(),
    format: z.enum(["csv", "jsonl", "json", "parquet", "avro", "auto"]),
    compression: nullableString,
    listing: nullableString,
    objectChunking: nullableString,
  }).passthrough(),
  z.object({
    kind: z.literal("changes"),
    scope: z.enum(["table", "database", "cluster"]),
    schema: nullableString,
    table: nullableString,
    publication: nullableString,
    emitsDeletes: z.boolean(),
    resumeTokenKind: nullableString,
  }).passthrough(),
  z.object({
    kind: z.literal("query"),
    language: z.enum(["soql", "sql", "other"]),
    querySketch: z.string(),
    paginator: paginatorSchema.optional(),
    incrementalParam: incrementalParamSchema.optional(),
  }).passthrough(),
  z.object({
    kind: z.literal("partitioned_log"),
    unit: z.string(),
    offsetKind: z.string(),
    shardable: z.boolean(),
    notes: z.string(),
  }).passthrough(),
]);
export type PullSpec = z.infer<typeof pullSpecSchema>;

export const connectorStreamSchema = z.object({
  name: z.string(),
  origin: z.enum(["static", "discovered"]),
  kind: z.enum(["actual", "archetype"]).optional(),
  primaryKey: z.array(z.string()),
  primaryKeyKind: z.enum(["columns", "json_pointers", "synthetic", "none"]),
  cursorField: nullableString,
  supportedSyncModes: z.array(z.enum(["full_refresh", "incremental"])).nonempty(),
  writeDisposition: z.enum(["merge", "append", "snapshot_with_tombstone"]),
  schedules: z.array(z.object({ role: z.string(), schedule: scheduleSchema }).passthrough()).optional(),
  // Early batches used singular `schedule`; it remains accepted as mined data
  // but capability code treats the absence of v2.1 schedules explicitly.
  schedule: scheduleSchema.nullable().optional(),
  pull: z.object({
    backfill: pullSpecSchema.nullable().optional(),
    incremental: pullSpecSchema.nullable().optional(),
    snapshot: pullSpecSchema.nullable().optional(),
  }).passthrough(),
}).passthrough();
export type ConnectorStream = z.infer<typeof connectorStreamSchema>;

const continuitySchema = z.object({
  artifacts: z.array(z.string()),
  customerSideAccrual: nullableString,
  ourSideLoss: nullableString,
  resumeWindow: nullableString,
  releasedOnShutdown: z.boolean().nullable(),
  notes: z.string(),
}).passthrough().nullable();

const evidenceSchema = z.record(z.object({
  file: z.string(),
  lines: z.string(),
  snippet: z.string(),
}).passthrough());

export const connectorDefinitionSchema = z.object({
  id: z.string(),
  estuaryDir: z.string(),
  displayName: z.string(),
  description: z.string(),
  category: connectorCategorySchema,
  transports: z.array(connectorTransportSchema).nonempty(),
  credentialModes: z.array(credentialModeSchema),
  execution: z.object({
    mode: z.enum(["poll", "log"]),
    defaultSchedule: scheduleSchema.nullable().optional(),
    schedule: scheduleSchema.nullable().optional(),
    continuity: continuitySchema,
  }).passthrough(),
  configFields: z.array(connectorConfigFieldSchema),
  streamMode: z.enum(["static", "discovered", "mixed"]),
  discovery: z.object({
    method: z.string(),
    querySketch: nullableString,
    excludes: z.array(z.string()),
    allowlist: nullableString,
  }).passthrough().nullable(),
  streams: z.array(connectorStreamSchema),
  authTierOverall: authTierSchema,
  authTierRationale: z.string(),
  unionMisfits: z.array(z.object({
    where: z.string(),
    description: z.string(),
    proposedShape: z.record(z.unknown()).nullable().optional(),
  }).passthrough()),
  evidence: evidenceSchema,
  confidence: z.record(z.enum(["high", "medium", "low"])),
  abstained: z.record(z.string()),
}).passthrough();

export type ConnectorDefinition = z.infer<typeof connectorDefinitionSchema>;
