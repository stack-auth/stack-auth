/**
 * Stream discovery and schema drift.
 *
 * The AI agent does NOT read anything here: it discovers what exists by
 * querying ClickHouse directly (`SELECT DISTINCT source_id, stream`, then a
 * sample of real rows), which is richer than any registry and cannot drift.
 *
 * These schemas serve the HUMAN UI, which has two needs ClickHouse cannot meet:
 * the stream selector must render BEFORE the first sync, when zero rows exist
 * and re-discovering on every page load would re-hit the customer's API; and an
 * enabled-but-empty stream has to stay visible, where DISTINCT over the imported
 * rows would report it as not connected at all.
 */
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import type { Json } from "@hexclave/shared/dist/utils/json";
import type { RunnableConnector, RunnableStream } from "./catalogue/capabilities";
import { pullSlice } from "./runtime";

export type DiscoveredField = {
  name: string,
  type: "string" | "number" | "boolean" | "object" | "array" | "null",
  /** Fraction of sampled records carrying this field, 0..1. */
  presence: number,
};

export type DiscoveredStreamSchema = {
  fields: DiscoveredField[],
  sampledRecords: number,
};

export type DiscoveredStream = {
  name: string,
  primaryKey: string[],
  cursorField: string | null,
  supportedSyncModes: string[],
  recommendedSyncMode: string,
  schema: DiscoveredStreamSchema | null,
  /** Set when this stream's sample could not be fetched; the rest still render. */
  error: string | null,
};

function classify(value: unknown): DiscoveredField["type"] {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "number": {
      return "number";
    }
    case "boolean": {
      return "boolean";
    }
    case "object": {
      return "object";
    }
    default: {
      return "string";
    }
  }
}

/**
 * Summarises a batch of records into a field list with presence rates.
 *
 * Presence, not just names: a field on 2% of records is real but easy to miss,
 * and reporting the rate lets both the UI and drift detection tell a genuinely
 * new field from one that simply was not in the last sample.
 */
export function summarizeRecordSchema(records: Json[]): DiscoveredStreamSchema {
  const counts = new Map<string, { count: number, types: Set<DiscoveredField["type"]> }>();
  let considered = 0;
  for (const record of records) {
    if (record == null || typeof record !== "object" || Array.isArray(record)) continue;
    considered += 1;
    for (const [key, value] of Object.entries(record)) {
      const entry = counts.get(key) ?? { count: 0, types: new Set<DiscoveredField["type"]>() };
      entry.count += 1;
      entry.types.add(classify(value));
      counts.set(key, entry);
    }
  }
  const fields: DiscoveredField[] = [...counts.entries()]
    .map(([name, entry]): DiscoveredField => {
      // A field seen as both null and something else is reported as that
      // something else: nullability is not a distinct schema type here.
      const concrete = [...entry.types].filter(type => type !== "null");
      return {
        name,
        type: concrete.length === 1 ? concrete[0] : concrete.length === 0 ? "null" : "object",
        presence: considered === 0 ? 0 : entry.count / considered,
      };
    })
    .sort((a, b) => b.presence - a.presence || stringCompare(a.name, b.name));
  return { fields, sampledRecords: considered };
}

/**
 * Discovers a connector's streams by pulling one small page from each.
 *
 * Bounded on purpose: discovery runs inside a request, and a connector with 48
 * streams must not turn a wizard step into 48 sequential full page reads. One
 * page per stream, in parallel batches, with per-stream failures isolated so a
 * single unavailable endpoint does not empty the selector.
 */
export async function discoverStreams(options: {
  manifest: RunnableConnector,
  config: Record<string, string>,
  secrets: Record<string, string>,
  /** Caps how many streams are probed; the rest report their static facts. */
  maxProbedStreams?: number,
  deadlineMs?: number,
  fetchImpl?: typeof fetch,
}): Promise<DiscoveredStream[]> {
  const maxProbed = options.maxProbedStreams ?? 12;
  const deadlineMs = options.deadlineMs ?? performance.now() + 25_000;

  const probe = async (stream: RunnableStream, shouldProbe: boolean): Promise<DiscoveredStream> => {
    const base: DiscoveredStream = {
      name: stream.name,
      primaryKey: stream.primaryKey,
      cursorField: stream.cursorField ?? null,
      supportedSyncModes: stream.supportedSyncModes,
      recommendedSyncMode: stream.supportedSyncModes.includes("incremental") ? "incremental" : "full_refresh",
      schema: null,
      error: null,
    };
    if (!shouldProbe || performance.now() >= deadlineMs) return base;
    try {
      const result = await pullSlice({
        manifest: options.manifest,
        stream,
        syncMode: "full_refresh",
        config: options.config,
        secrets: options.secrets,
        state: {},
        maxRecords: 25,
        maxRequests: 1,
        deadlineMs,
        fetchImpl: options.fetchImpl,
      });
      return { ...base, schema: summarizeRecordSchema(result.records.map(record => record.data)) };
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const results: DiscoveredStream[] = [];
  const streams = options.manifest.streams;
  const CONCURRENCY = 4;
  for (let i = 0; i < streams.length; i += CONCURRENCY) {
    const batch = streams.slice(i, i + CONCURRENCY);
    results.push(...await Promise.all(batch.map(stream => probe(stream, i < maxProbed))));
  }
  return results;
}

export type SchemaDrift = {
  addedFields: DiscoveredField[],
  removedFields: string[],
  changedFields: Array<{ name: string, from: string, to: string }>,
  detectedAt: string,
};

/**
 * Diffs an incoming sample against the stored discovery schema.
 *
 * Returns null when nothing meaningful changed, so the presence of a drift
 * record is itself the "needs review" signal. A field appearing in the new
 * sample but absent from the old is only reported as ADDED when it is present
 * on a reasonable share of records — otherwise every sparse optional field
 * would raise drift on the sampling luck of a single slice.
 */
export function detectSchemaDrift(
  storedSchema: Json | null,
  observed: DiscoveredStreamSchema,
): SchemaDrift | null {
  const stored = parseStoredSchema(storedSchema);
  if (stored == null || stored.fields.length === 0) return null;
  if (observed.sampledRecords === 0) return null;

  const storedByName = new Map(stored.fields.map(field => [field.name, field]));
  const observedByName = new Map(observed.fields.map(field => [field.name, field]));

  const MIN_PRESENCE_TO_REPORT = 0.1;
  const addedFields = observed.fields.filter(field =>
    !storedByName.has(field.name) && field.presence >= MIN_PRESENCE_TO_REPORT);
  // Removal is only claimed for fields that used to be reliably present:
  // a field that was already sparse can vanish from a sample by chance.
  const removedFields = stored.fields
    .filter(field => field.presence >= 0.9 && !observedByName.has(field.name))
    .map(field => field.name);
  const changedFields = stored.fields.flatMap(field => {
    const now = observedByName.get(field.name);
    if (now == null || now.type === field.type || now.type === "null" || field.type === "null") return [];
    return [{ name: field.name, from: field.type, to: now.type }];
  });

  if (addedFields.length === 0 && removedFields.length === 0 && changedFields.length === 0) {
    return null;
  }
  return { addedFields, removedFields, changedFields, detectedAt: new Date().toISOString() };
}

function parseStoredSchema(value: Json | null): DiscoveredStreamSchema | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = (value as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return null;
  return {
    fields: fields.flatMap(field => {
      if (field == null || typeof field !== "object") return [];
      const record = field as Record<string, unknown>;
      if (typeof record.name !== "string") return [];
      return [{
        name: record.name,
        type: (record.type ?? "string") as DiscoveredField["type"],
        presence: typeof record.presence === "number" ? record.presence : 1,
      }];
    }),
    sampledRecords: typeof (value as { sampledRecords?: unknown }).sampledRecords === "number"
      ? (value as { sampledRecords: number }).sampledRecords
      : 0,
  };
}

import.meta.vitest?.describe("schema discovery", () => {
  import.meta.vitest?.test("summarises fields with presence rates", ({ expect }) => {
    const schema = summarizeRecordSchema([
      { id: "1", email: "a@example.com", plan: "pro" },
      { id: "2", email: "b@example.com" },
    ] as unknown as Json[]);
    expect(schema.sampledRecords).toBe(2);
    expect(schema.fields.find(f => f.name === "id")?.presence).toBe(1);
    expect(schema.fields.find(f => f.name === "plan")?.presence).toBe(0.5);
  });

  import.meta.vitest?.test("no drift when the shape is unchanged", ({ expect }) => {
    const stored = summarizeRecordSchema([{ id: "1", email: "a@example.com" }] as unknown as Json[]);
    const observed = summarizeRecordSchema([{ id: "2", email: "b@example.com" }] as unknown as Json[]);
    expect(detectSchemaDrift(stored as unknown as Json, observed)).toBeNull();
  });

  import.meta.vitest?.test("reports added, removed, and retyped fields", ({ expect }) => {
    const stored = summarizeRecordSchema([{ id: "1", email: "a@example.com", age: 30 }] as unknown as Json[]);
    const observed = summarizeRecordSchema([{ id: "2", age: "30", country: "US" }] as unknown as Json[]);
    const drift = detectSchemaDrift(stored as unknown as Json, observed);
    expect(drift?.addedFields.map(f => f.name)).toEqual(["country"]);
    expect(drift?.removedFields).toEqual(["email"]);
    expect(drift?.changedFields).toEqual([{ name: "age", from: "number", to: "string" }]);
  });

  import.meta.vitest?.test("a rare new field does not raise drift on sampling luck", ({ expect }) => {
    const stored = summarizeRecordSchema([{ id: "1" }] as unknown as Json[]);
    const observed = summarizeRecordSchema(
      Array.from({ length: 20 }, (_, i) => (i === 0 ? { id: "x", beta_flag: true } : { id: "x" })) as unknown as Json[],
    );
    expect(detectSchemaDrift(stored as unknown as Json, observed)).toBeNull();
  });
});
