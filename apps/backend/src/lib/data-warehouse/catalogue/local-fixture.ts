import { connectorDefinitionSchema } from "./schema";

/**
 * Hexclave's generic REST escape hatch, expressed in the same schema as every
 * mined connector. It also gives E2E tests a connector that can target a local
 * fixture without carrying a second runtime-only catalogue model.
 */
export const LOCAL_FIXTURE_CONNECTOR = connectorDefinitionSchema.parse({
  id: "custom-rest",
  estuaryDir: "hexclave/custom-rest",
  displayName: "Custom REST API",
  description: "Import data from any REST API that returns JSON.",
  category: "other",
  transports: [{
    role: "primary",
    purpose: null,
    spec: {
      kind: "http",
      baseUrl: {
        kind: "template",
        template: "{base_url}",
        placeholders: { base_url: "endpoint config base_url" },
      },
      defaultHeaders: null,
      apiVersionPinning: null,
    },
  }],
  credentialModes: [{
    name: "Bearer token",
    appliesToTransport: "primary",
    tier: "T1_SIMPLE",
    scheme: {
      type: "header",
      header: "Authorization",
      field: "credentials.access_token",
      prefix: "Bearer ",
    },
  }],
  execution: { mode: "poll", defaultSchedule: { kind: "interval", seconds: 300 }, continuity: null },
  configFields: [
    {
      name: "base_url", displayName: "Base URL", required: true, secret: false,
      scope: "endpoint", type: "string", description: "The API base URL without a trailing slash.",
    },
    {
      name: "stream_path", displayName: "Collection path", required: true, secret: false,
      scope: "endpoint", type: "string", description: "The collection path relative to the base URL.",
    },
    {
      name: "records_path", displayName: "Records path", required: false, secret: false,
      scope: "endpoint", type: "string", description: "Dot path to the response's record array; blank means the response itself.",
    },
    {
      name: "credentials.access_token", displayName: "API key", required: true, secret: true,
      scope: "endpoint", type: "string", description: "Sent as a bearer token in the Authorization header.",
    },
  ],
  streamMode: "static",
  discovery: null,
  streams: [{
    name: "records",
    origin: "static",
    kind: "actual",
    primaryKey: ["id"],
    primaryKeyKind: "columns",
    cursorField: "updated_at",
    supportedSyncModes: ["full_refresh", "incremental"],
    writeDisposition: "merge",
    schedules: [{ role: "main poll", schedule: { kind: "interval", seconds: 300 } }],
    pull: {
      backfill: {
        kind: "http", path: "{stream_path}", httpMethod: "GET",
        recordsPath: "{records_path}", params: null, pathPlaceholders: null,
        paginator: {
          type: "offset", limitParam: "limit", offsetParam: "offset",
          pageSize: 100, terminateOn: "short_page",
        },
        incrementalParam: null,
      },
      incremental: {
        kind: "http", path: "{stream_path}", httpMethod: "GET",
        recordsPath: "{records_path}", params: null, pathPlaceholders: null,
        paginator: {
          type: "offset", limitParam: "limit", offsetParam: "offset",
          pageSize: 100, terminateOn: "short_page",
        },
        incrementalParam: { param: "updated_since", format: "iso8601" },
      },
      snapshot: null,
    },
  }],
  authTierOverall: "T1_SIMPLE",
  authTierRationale: "A single self-serve bearer token.",
  unionMisfits: [],
  evidence: {},
  confidence: {},
  abstained: {},
});
