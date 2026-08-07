/**
 * The manifest runtime: one interpreter for every connector in the catalogue.
 *
 * The execution model is the standard declarative-connector one — a stream is a
 * requester (URL + auth + params), a paginator, a record selector, and an
 * optional incremental cursor — and it is deliberately BOUNDED and RESUMABLE.
 * There is no hosted worker here: syncs advance one slice per cron tick (see
 * `sync.ts`), so `pullSlice` must always return well inside a serverless
 * timeout with enough state to carry on from exactly where it stopped.
 */
import { assertSafeDataSourceUrl } from "@/lib/ssrf-protection/data-sources";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import type { Json } from "@hexclave/shared/dist/utils/json";
import {
  evaluateConnectorCapability, getPullForSyncMode,
  type RunnableConnector, type RunnableHttpPull, type RunnableStream, type RuntimeSyncMode,
} from "./catalogue/capabilities";
import { connectorDefinitionSchema } from "./catalogue/schema";

/**
 * Connector settings as supplied by the customer. Values are optional because
 * these bags arrive as JSON: a key the manifest declares may simply be absent,
 * and every read below checks for that rather than trusting the index type.
 */
export type ConnectorConfigValues = Record<string, string | undefined>;

/**
 * Resumable position within a single stream.
 *
 * `page` is the paginator's own token and is meaningless across runs of
 * different shapes; `cursor` is the incremental high-water mark and IS durable
 * across syncs. Keeping them in one object means a slice hand-off persists a
 * single JSON blob.
 */
export type StreamSliceState = {
  page?: {
    offset?: number,
    pageNumber?: number,
    cursor?: string,
    nextUrl?: string,
  },
  /**
   * DURABLE high-water mark of `cursorField`, carried between syncs. Only ever
   * advanced when a stream drains completely, so an interrupted sync can never
   * cause the next one to skip records it has not read.
   */
  cursor?: string,
  /**
   * High-water mark observed so far WITHIN the current sync, accumulated across
   * ticks. Without this a multi-tick stream would end up with only its final
   * tick's maximum — or none at all, if the last tick happened to read an empty
   * page — silently losing everything the earlier ticks saw.
   */
  pendingCursor?: string,
  /** Records emitted for this stream in the current sync run. */
  emitted?: number,
};

export type ImportedRecord = {
  /** Stable per-stream identity, used as the ClickHouse merge key. */
  pk: string,
  data: Json,
  extractedAt: Date,
};

export type PullSliceResult = {
  records: ImportedRecord[],
  state: StreamSliceState,
  /** True when the stream has no more pages to read in this sync. */
  done: boolean,
  requestCount: number,
};

export type PullSliceOptions = {
  manifest: RunnableConnector,
  stream: RunnableStream,
  syncMode: RuntimeSyncMode,
  /** Overrides the manifest default, so a user can pick a different key. */
  cursorField?: string | null,
  primaryKey?: string[] | null,
  config: ConnectorConfigValues,
  secrets: ConnectorConfigValues,
  state: StreamSliceState,
  /** Hard ceilings for one tick. Whichever binds first ends the slice. */
  maxRecords: number,
  maxRequests: number,
  deadlineMs: number,
  fetchImpl?: typeof fetch,
};

const REQUEST_TIMEOUT_MS = 30_000;
/** Cap a single response body so one pathological stream cannot exhaust memory. */
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

/**
 * A provider-side failure, carrying the raw upstream message.
 *
 * The setup wizard's test gate shows `providerMessage` verbatim. That is a
 * product requirement, not a debugging nicety: "Invalid API Key provided:
 * sk_test_***" tells the user exactly what to fix, where "Connection failed"
 * sends them to support.
 */
export class ConnectorRequestError extends StatusError {
  constructor(
    public readonly status: number,
    public readonly providerMessage: string,
    public readonly url: string,
  ) {
    super(StatusError.BadRequest, `Data source request failed with HTTP ${status}: ${providerMessage}`);
    this.name = "ConnectorRequestError";
  }

  /** Revoked or rotated credentials — surfaced loudly rather than as stale data. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/**
 * Replaces `{config.x}` / `{secrets.x}` placeholders in manifest strings.
 *
 * Values are substituted RAW rather than percent-encoded, because the same
 * mechanism fills in whole base URLs (`https://api.example.com/v1`) and
 * multi-segment paths (`api/v2/records`), both of which encoding would destroy.
 * Structural safety comes from two other places instead: values carrying
 * whitespace, control characters, or `..` traversal are rejected here, and the
 * fully-assembled URL is re-validated by the SSRF guard before any request
 * leaves the process.
 */
export function interpolate(
  template: string,
  config: ConnectorConfigValues,
  secrets: ConnectorConfigValues,
): string {
  const validateValue = (name: string, value: string | undefined): string => {
    if (value == null || value === "") {
      throw new StatusError(StatusError.BadRequest, `Data source is missing required setting "${name}".`);
    }
    if (/[\s\u0000-\u001f\u007f]/.test(value)) {
      throw new StatusError(StatusError.BadRequest, `Data source setting "${name}" contains invalid characters.`);
    }
    if (value.split("/").includes("..")) {
      throw new StatusError(StatusError.BadRequest, `Data source setting "${name}" must not contain path traversal.`);
    }
    return value;
  };

  const scoped = template.replace(/\{(config|secrets)\.([A-Za-z0-9_.]+)\}/g, (_match, scope: string, name: string) => {
    const source = scope === "config" ? config : secrets;
    return validateValue(name, source[name]);
  });
  return scoped.replace(/\{([A-Za-z0-9_.]+)\}/g, (_match, name: string) =>
    validateValue(name, config[name] ?? secrets[name]));
}

/** Reads a dot-separated path out of a JSON body. Returns undefined if absent. */
export function readPath(body: unknown, path: string | undefined): unknown {
  if (path == null || path === "") return body;
  let current: unknown = body;
  const segments = path.startsWith("/")
    ? path.slice(1).split("/").map(segment => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    : path.split(".");
  for (const segment of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function applyAuth(
  manifest: RunnableConnector,
  url: URL,
  headers: Record<string, string>,
  secrets: ConnectorConfigValues,
): void {
  const auth = manifest.credentialMode.scheme;
  const requireSecret = (field: string) => {
    const value = secrets[field];
    if (value == null || value === "") {
      throw new StatusError(StatusError.BadRequest, `Data source is missing credential "${field}".`);
    }
    return value;
  };
  switch (auth.type) {
    case "bearer": {
      headers["Authorization"] = `Bearer ${requireSecret(auth.field)}`;
      break;
    }
    case "header": {
      headers[auth.header] = `${auth.prefix ?? ""}${requireSecret(auth.field)}`;
      break;
    }
    case "basic": {
      const username = requireSecret(auth.usernameField);
      const password = auth.passwordField.startsWith("<none") ? "" : requireSecret(auth.passwordField);
      headers["Authorization"] = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      break;
    }
    case "query": {
      url.searchParams.set(auth.param, requireSecret(auth.field));
      break;
    }
  }
}

function buildRequestUrl(options: PullSliceOptions): URL {
  const { manifest, stream, config, secrets, state } = options;
  const pull = getPullForSyncMode(stream.definition, options.syncMode) ?? throwUnsupportedPull(manifest, stream, options.syncMode);
  // A `next_url` paginator hands us an absolute URL for every page after the
  // first, so the manifest's own path is only used to start the walk.
  if (state.page?.nextUrl != null) {
    return new URL(state.page.nextUrl);
  }
  const baseUrl = manifest.transport.spec.baseUrl;
  const base = interpolate(baseUrl.kind === "constant" ? baseUrl.value : baseUrl.template, config, secrets);
  const path = interpolate(pull.path, config, secrets);
  const url = new URL(`${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);

  for (const [key, value] of Object.entries(pull.params ?? {})) {
    const rendered = typeof value === "string" ? interpolate(value, config, secrets) : String(value);
    url.searchParams.set(key, rendered);
  }

  applyPaginatorParams(url, pull, state);
  applyIncrementalParams(url, pull, options);
  return url;
}

function throwUnsupportedPull(
  manifest: RunnableConnector,
  stream: RunnableStream,
  syncMode: RuntimeSyncMode,
): never {
  throw new StatusError(
    StatusError.BadRequest,
    `Connector "${manifest.id}" stream "${stream.name}" has no executable ${syncMode} pull shape.`,
  );
}

function applyPaginatorParams(url: URL, pull: RunnableHttpPull, state: StreamSliceState): void {
  const paginator = pull.paginator;
  switch (paginator.type) {
    case "none":
    case "next_url": {
      break;
    }
    case "offset": {
      if (paginator.limitParam == null) throw new HexclaveAssertionError("Runnable offset paginator is missing limitParam");
      url.searchParams.set(paginator.limitParam, String(paginator.pageSize));
      url.searchParams.set(paginator.offsetParam, String(state.page?.offset ?? 0));
      break;
    }
    case "page": {
      if (paginator.limitParam == null || paginator.pageSize == null) {
        throw new HexclaveAssertionError("Runnable page paginator is missing limitParam or pageSize");
      }
      url.searchParams.set(paginator.limitParam, String(paginator.pageSize));
      url.searchParams.set(paginator.pageParam, String(state.page?.pageNumber ?? paginator.startPage));
      break;
    }
    case "cursor": {
      if (paginator.pageSizeParam != null && paginator.pageSize != null) {
        url.searchParams.set(paginator.pageSizeParam, String(paginator.pageSize));
      }
      if (state.page?.cursor != null) {
        url.searchParams.set(paginator.cursorParam ?? "", state.page.cursor);
      }
      break;
    }
    case "record_cursor": {
      if (paginator.pageSizeParam != null && paginator.pageSize != null) {
        url.searchParams.set(paginator.pageSizeParam, String(paginator.pageSize));
      }
      if (state.page?.cursor != null) {
        url.searchParams.set(paginator.param, state.page.cursor);
      }
      break;
    }
    case "body_cursor": {
      // Capability evaluation currently rejects request-body pagination.
      break;
    }
  }
}

function applyIncrementalParams(url: URL, pull: RunnableHttpPull, options: PullSliceOptions): void {
  const { syncMode, state } = options;
  if (syncMode !== "incremental") return;
  const incremental = pull.incrementalParam;
  if (incremental == null || state.cursor == null) return;
  const since = new Date(state.cursor);
  if (Number.isNaN(since.getTime())) return;
  switch (incremental.format) {
    case "iso8601": {
      url.searchParams.set(incremental.param, since.toISOString());
      break;
    }
    case "unix_seconds": {
      url.searchParams.set(incremental.param, String(Math.floor(since.getTime() / 1000)));
      break;
    }
    case "unix_milliseconds": {
      url.searchParams.set(incremental.param, String(since.getTime()));
      break;
    }
    case "date": {
      url.searchParams.set(incremental.param, since.toISOString().slice(0, 10));
      break;
    }
  }
}

/**
 * Derives the next page's state, or null when the walk is finished.
 *
 * Short-page termination is used wherever the API does not report totals: it is
 * the one signal available on every paginated collection, and it is correct
 * even when a `count` field exists but lies.
 */
function advancePage(
  pull: RunnableHttpPull,
  state: StreamSliceState,
  body: unknown,
  records: unknown[],
): StreamSliceState["page"] | null {
  const paginator = pull.paginator;
  switch (paginator.type) {
    case "none": {
      return null;
    }
    case "offset": {
      if (records.length < paginator.pageSize) return null;
      return { offset: (state.page?.offset ?? 0) + records.length };
    }
    case "page": {
      if (paginator.pageSize == null) throw new HexclaveAssertionError("Runnable page paginator is missing pageSize");
      if (records.length < paginator.pageSize) return null;
      return { pageNumber: (state.page?.pageNumber ?? paginator.startPage) + 1 };
    }
    case "cursor": {
      const rawNext = readPath(body, paginator.cursorPath);
      if (typeof rawNext !== "string" || rawNext === "") return null;
      if (paginator.tokenFrom === "url_query") {
        const cursorParam = paginator.cursorParam;
        if (cursorParam == null) return null;
        const nextUrl = new URL(rawNext, "https://connector.invalid");
        const token = nextUrl.searchParams.get(cursorParam);
        return token == null || token === "" ? null : { cursor: token };
      }
      return { cursor: rawNext };
    }
    case "next_url": {
      const next = readPath(body, paginator.nextUrlPath);
      if (typeof next !== "string" || next === "") return null;
      return { nextUrl: next };
    }
    case "record_cursor": {
      if (paginator.hasMorePath != null) {
        const hasMore = readPath(body, paginator.hasMorePath);
        if (hasMore !== true) return null;
      } else if (records.length < (paginator.pageSize ?? records.length + 1)) {
        return null;
      }
      const last = records[records.length - 1];
      if (last == null || typeof last !== "object") return null;
      const token = (last as Record<string, unknown>)[paginator.recordField];
      if (typeof token !== "string" && typeof token !== "number") return null;
      return { cursor: String(token) };
    }
    case "body_cursor": {
      return null;
    }
  }
}

/**
 * Best-effort extraction of the provider's own error text.
 *
 * Providers disagree on the envelope (`error.message`, `errors[0].detail`,
 * `message`, or plain text), and the test gate is only useful if it shows what
 * the provider actually said, so all the common shapes are tried before
 * falling back to the raw body.
 */
export function extractProviderMessage(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (trimmed === "") return "(empty response body)";
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return trimmed.slice(0, 500);
  }
  const candidates = [
    readPath(parsed, "error.message"),
    readPath(parsed, "error.detail"),
    readPath(parsed, "message"),
    readPath(parsed, "detail"),
    readPath(parsed, "error"),
    readPath(parsed, "errors.0.detail"),
    readPath(parsed, "errors.0.message"),
    readPath(parsed, "errors.0.title"),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
  }
  return trimmed.slice(0, 500);
}

/**
 * A user-supplied records path wins over the manifest's, and an explicitly
 * blank one means "the response body IS the array".
 */
function resolveRecordsPath(
  pull: RunnableHttpPull,
  config: ConnectorConfigValues,
  secrets: ConnectorConfigValues,
): string | undefined {
  if (pull.recordsPath == null || pull.recordsPath === "") return undefined;
  const singlePlaceholder = /^\{([A-Za-z0-9_.]+)\}$/.exec(pull.recordsPath);
  if (singlePlaceholder != null) {
    const configured = config[singlePlaceholder[1]] ?? secrets[singlePlaceholder[1]];
    return configured == null || configured === "" ? undefined : configured;
  }
  return interpolate(pull.recordsPath, config, secrets);
}

function computePrimaryKey(record: Record<string, unknown>, primaryKey: string[], fallback: string): string {
  if (primaryKey.length === 0) return fallback;
  const parts = primaryKey.map(field => {
    const value = readPath(record, field);
    return value == null ? "" : String(value);
  });
  // A record missing every key field cannot be merged on identity; treat it as
  // keyless rather than collapsing all such rows onto one merge key.
  if (parts.every(part => part === "")) return fallback;
  return parts.join("|");
}

function readCursorValue(record: Record<string, unknown>, cursorField: string | null | undefined): string | null {
  if (cursorField == null || cursorField === "") return null;
  const raw = readPath(record, cursorField);
  if (raw == null) return null;
  if (typeof raw === "number") {
    // Unix seconds vs milliseconds: anything below this threshold is seconds.
    const millis = raw < 100_000_000_000 ? raw * 1000 : raw;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof raw === "string") {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

async function requestPage(
  url: URL,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  await assertSafeDataSourceUrl(url.toString());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      signal: controller.signal,
      redirect: "error",
    });
  } catch (error) {
    // Network-level failures (DNS, TLS, timeout) carry no HTTP status, but the
    // user still needs the underlying reason to fix their setup.
    throw new ConnectorRequestError(0, error instanceof Error ? error.message : String(error), url.toString());
  } finally {
    clearTimeout(timer);
  }

  const raw = await readBoundedText(response);
  if (!response.ok) {
    throw new ConnectorRequestError(response.status, extractProviderMessage(raw), url.toString());
  }
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ConnectorRequestError(response.status, "Response was not valid JSON.", url.toString());
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new StatusError(StatusError.BadRequest, "Data source response exceeded the maximum supported size.");
  }
  return text;
}

/**
 * Pulls one bounded slice of a stream, returning the records read and the state
 * needed to continue. Stops at whichever of the record / request / deadline
 * budgets binds first — never at a natural end-of-stream alone.
 */
export async function pullSlice(options: PullSliceOptions): Promise<PullSliceResult> {
  const { manifest, stream, state, maxRecords, maxRequests, deadlineMs } = options;
  const pull = getPullForSyncMode(stream.definition, options.syncMode)
    ?? throwUnsupportedPull(manifest, stream, options.syncMode);
  const fetchImpl = options.fetchImpl ?? fetch;
  const primaryKey = options.primaryKey ?? stream.primaryKey;
  const cursorField = options.cursorField ?? stream.cursorField;
  const effectiveSyncMode = options.syncMode;

  const records: ImportedRecord[] = [];
  let workingState: StreamSliceState = { ...state };
  let requestCount = 0;
  let done = false;
  // Resume from whatever this sync has already seen, not just from the
  // durable cursor, so a mark observed in an earlier tick survives.
  let highWaterMark = state.pendingCursor ?? state.cursor ?? null;

  while (true) {
    if (requestCount >= maxRequests || records.length >= maxRecords || performance.now() >= deadlineMs) {
      break;
    }

    const url = buildRequestUrl({ ...options, state: workingState });
    const headers: Record<string, string> = { ...(manifest.transport.spec.defaultHeaders ?? {}) };
    applyAuth(manifest, url, headers, options.secrets);

    const body = await requestPage(url, headers, fetchImpl);
    requestCount += 1;

    const selected = readPath(body, resolveRecordsPath(pull, options.config, options.secrets));
    const pageRecords = Array.isArray(selected) ? selected : [];
    const extractedAt = new Date();

    for (const [index, entry] of pageRecords.entries()) {
      if (entry == null || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const recordCursor = readCursorValue(record, cursorField);

      // Client-side incremental filtering for streams whose API offers no
      // server-side "updated since" parameter. Correct, but it still reads the
      // whole collection — which is why `incrementalParam` is preferred.
      if (
        effectiveSyncMode === "incremental"
        && pull.incrementalParam == null
        && state.cursor != null
        && recordCursor != null
        && recordCursor <= state.cursor
      ) {
        continue;
      }

      const fallbackKey = `${workingState.page?.offset ?? workingState.page?.pageNumber ?? workingState.page?.cursor ?? "0"}:${(state.emitted ?? 0) + records.length + index}`;
      records.push({
        pk: computePrimaryKey(record, primaryKey, fallbackKey),
        data: record as Json,
        extractedAt,
      });
      if (recordCursor != null && (highWaterMark == null || recordCursor > highWaterMark)) {
        highWaterMark = recordCursor;
      }
    }

    const nextPage = advancePage(pull, workingState, body, pageRecords);
    if (nextPage == null) {
      done = true;
      workingState = { ...workingState, page: undefined };
      break;
    }
    workingState = { ...workingState, page: nextPage };
  }

  return {
    records,
    state: {
      ...workingState,
      // The durable cursor only advances once the stream has finished: promoting
      // a mid-sync mark would skip the records the next tick has not read yet.
      // Until then the mark is parked in `pendingCursor`.
      cursor: done && effectiveSyncMode === "incremental"
        ? (highWaterMark ?? workingState.cursor)
        : workingState.cursor,
      pendingCursor: done ? undefined : (highWaterMark ?? undefined),
      emitted: (state.emitted ?? 0) + records.length,
    },
    done,
    requestCount,
  };
}

/**
 * The setup wizard's hard gate. Pulls exactly one page from the connector's
 * designated check stream and returns the provider's own error on failure.
 */
export async function testConnection(options: {
  manifest: RunnableConnector,
  config: ConnectorConfigValues,
  secrets: ConnectorConfigValues,
  fetchImpl?: typeof fetch,
}): Promise<{ ok: true, sampleRecordCount: number } | { ok: false, status: number, providerMessage: string }> {
  const { manifest } = options;
  const stream = manifest.streams.at(0);
  if (stream == null) {
    return { ok: false, status: 0, providerMessage: `Connector "${manifest.id}" declares no streams to test against.` };
  }
  try {
    const result = await pullSlice({
      manifest,
      stream,
      syncMode: "full_refresh",
      config: options.config,
      secrets: options.secrets,
      state: {},
      maxRecords: 1,
      maxRequests: 1,
      deadlineMs: performance.now() + REQUEST_TIMEOUT_MS,
      fetchImpl: options.fetchImpl,
    });
    return { ok: true, sampleRecordCount: result.records.length };
  } catch (error) {
    if (error instanceof ConnectorRequestError) {
      return { ok: false, status: error.status, providerMessage: error.providerMessage };
    }
    throw error;
  }
}

import.meta.vitest?.describe("generic connector runtime", () => {
  function createFixture(options: {
    paginator: unknown,
    cursorField?: string | null,
    syncModes?: RuntimeSyncMode[],
  }): { manifest: RunnableConnector, stream: RunnableStream } {
    const syncModes = options.syncModes ?? ["full_refresh"];
    const pull = {
      kind: "http", path: "items", httpMethod: "GET", recordsPath: "data",
      params: null, pathPlaceholders: null, paginator: options.paginator,
      incrementalParam: null,
    };
    const definition = connectorDefinitionSchema.parse({
      id: "fixture", estuaryDir: "fixture", displayName: "Fixture", description: "",
      category: "other",
      transports: [{ role: "primary", purpose: null, spec: {
        kind: "http", baseUrl: { kind: "constant", value: "https://api.example.com/v1" },
        defaultHeaders: null, apiVersionPinning: null,
      } }],
      credentialModes: [{ name: "token", appliesToTransport: "primary", tier: "T1_SIMPLE", scheme: {
        type: "bearer", field: "credentials.access_token",
      } }],
      execution: { mode: "poll", defaultSchedule: null, continuity: null },
      configFields: [{ name: "credentials.access_token", displayName: "Token", required: true,
        secret: true, scope: "endpoint", type: "string", description: null }],
      streamMode: "static", discovery: null,
      streams: [{
        name: "items", origin: "static", kind: "actual", primaryKey: ["id"],
        primaryKeyKind: "columns", cursorField: options.cursorField ?? null,
        supportedSyncModes: syncModes, writeDisposition: "merge", schedules: [],
        pull: {
          backfill: syncModes.includes("full_refresh") ? pull : null,
          incremental: syncModes.includes("incremental") ? pull : null,
          snapshot: null,
        },
      }],
      authTierOverall: "T1_SIMPLE", authTierRationale: "fixture",
      unionMisfits: [], evidence: {}, confidence: {}, abstained: {},
    });
    const capability = evaluateConnectorCapability(definition);
    if (capability.status === "unsupported") {
      throw new Error(`Fixture is not runnable: ${capability.reasons.join("; ")}`);
    }
    const stream = capability.runnable.streams.at(0);
    if (stream == null) throw new Error("Fixture has no runnable stream");
    return { manifest: capability.runnable, stream };
  }

  function mockFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
    return async input => await handler(new Request(input).url);
  }

  import.meta.vitest?.test("offset paginator walks until a short page", async ({ expect }) => {
    const { manifest, stream } = createFixture({
      paginator: { type: "offset", limitParam: "limit", offsetParam: "offset", pageSize: 2, terminateOn: "short_page" },
    });
    const seen: string[] = [];
    const fetchImpl = mockFetch(url => {
      seen.push(url);
      const offset = Number(new URL(url).searchParams.get("offset"));
      return new Response(JSON.stringify({ data: offset === 0 ? [{ id: "a" }, { id: "b" }] : [{ id: "c" }] }));
    });
    const result = await pullSlice({
      manifest, stream, syncMode: "full_refresh", config: {}, secrets: { "credentials.access_token": "k" },
      state: {}, maxRecords: 100, maxRequests: 10, deadlineMs: performance.now() + 10_000, fetchImpl,
    });
    expect(result.records.map(record => record.pk)).toEqual(["a", "b", "c"]);
    expect(result.done).toBe(true);
    expect(seen).toHaveLength(2);
  });

  import.meta.vitest?.test("record budget suspends and resumes without skipping", async ({ expect }) => {
    const { manifest, stream } = createFixture({
      paginator: { type: "offset", limitParam: "limit", offsetParam: "offset", pageSize: 2, terminateOn: "short_page" },
    });
    const fetchImpl = mockFetch(url => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      const data = offset >= 4 ? [{ id: "e" }] : [{ id: `${offset}a` }, { id: `${offset}b` }];
      return new Response(JSON.stringify({ data }));
    });
    const first = await pullSlice({
      manifest, stream, syncMode: "full_refresh", config: {}, secrets: { "credentials.access_token": "k" },
      state: {}, maxRecords: 2, maxRequests: 10, deadlineMs: performance.now() + 10_000, fetchImpl,
    });
    expect(first.done).toBe(false);
    expect(first.state.page?.offset).toBe(2);
    const second = await pullSlice({
      manifest, stream, syncMode: "full_refresh", config: {}, secrets: { "credentials.access_token": "k" },
      state: first.state, maxRecords: 100, maxRequests: 10, deadlineMs: performance.now() + 10_000, fetchImpl,
    });
    expect(second.records.map(record => record.pk)).toEqual(["2a", "2b", "e"]);
  });

  import.meta.vitest?.test("record cursor follows the last record id", async ({ expect }) => {
    const { manifest, stream } = createFixture({ paginator: {
      type: "record_cursor", param: "starting_after", recordField: "id", hasMorePath: "has_more",
      tokenFrom: "last_record", tokenTo: "query_param", terminateOn: "envelope_flag",
    } });
    const fetchImpl = mockFetch(url => {
      const after = new URL(url).searchParams.get("starting_after");
      return new Response(JSON.stringify(after == null
        ? { data: [{ id: "ch_1" }], has_more: true }
        : { data: [{ id: "ch_2" }], has_more: false }));
    });
    const result = await pullSlice({
      manifest, stream, syncMode: "full_refresh", config: {}, secrets: { "credentials.access_token": "k" },
      state: {}, maxRecords: 100, maxRequests: 10, deadlineMs: performance.now() + 10_000, fetchImpl,
    });
    expect(result.records.map(record => record.pk)).toEqual(["ch_1", "ch_2"]);
  });

  import.meta.vitest?.test("incremental cursor advances only after the stream drains", async ({ expect }) => {
    const { manifest, stream } = createFixture({
      paginator: { type: "offset", limitParam: "limit", offsetParam: "offset", pageSize: 1, terminateOn: "short_page" },
      cursorField: "updated_at", syncModes: ["full_refresh", "incremental"],
    });
    const fetchImpl = mockFetch(url => new Response(JSON.stringify({
      data: Number(new URL(url).searchParams.get("offset")) === 0
        ? [{ id: "a", updated_at: "2026-01-01T00:00:00Z" }]
        : [],
    })));
    const suspended = await pullSlice({
      manifest, stream, syncMode: "incremental", config: {}, secrets: { "credentials.access_token": "k" },
      state: {}, maxRecords: 1, maxRequests: 10, deadlineMs: performance.now() + 10_000, fetchImpl,
    });
    expect(suspended.state.cursor).toBeUndefined();
    const finished = await pullSlice({
      manifest, stream, syncMode: "incremental", config: {}, secrets: { "credentials.access_token": "k" },
      state: suspended.state, maxRecords: 100, maxRequests: 10, deadlineMs: performance.now() + 10_000, fetchImpl,
    });
    expect(finished.state.cursor).toBe("2026-01-01T00:00:00.000Z");
  });

  import.meta.vitest?.test("provider error text survives the connection gate", async ({ expect }) => {
    const { manifest } = createFixture({ paginator: { type: "none" } });
    const fetchImpl = mockFetch(() => new Response(
      JSON.stringify({ error: { message: "Invalid API key" } }),
      { status: 401 },
    ));
    const result = await testConnection({
      manifest, config: {}, secrets: { "credentials.access_token": "bad" }, fetchImpl,
    });
    expect(result).toEqual({ ok: false, status: 401, providerMessage: "Invalid API key" });
  });

  import.meta.vitest?.test("keyless records receive distinct positional identities", async ({ expect }) => {
    const { manifest, stream } = createFixture({ paginator: { type: "none" } });
    const fetchImpl = mockFetch(() => new Response(JSON.stringify({ data: [{ name: "x" }, { name: "y" }] })));
    const result = await pullSlice({
      manifest, stream, syncMode: "full_refresh", primaryKey: [], config: {},
      secrets: { "credentials.access_token": "k" }, state: {}, maxRecords: 100,
      maxRequests: 10, deadlineMs: performance.now() + 10_000, fetchImpl,
    });
    expect(new Set(result.records.map(record => record.pk)).size).toBe(2);
  });

  import.meta.vitest?.test("JSON pointers and template placeholders are interpreted directly", ({ expect }) => {
    expect(readPath({ data: { items: [1] } }, "/data/items")).toEqual([1]);
    expect(interpolate("https://{subdomain}.example.com", { subdomain: "acme" }, {}))
      .toBe("https://acme.example.com");
    expect(() => interpolate("https://{subdomain}.example.com", {}, {}))
      .toThrow('missing required setting "subdomain"');
  });
});
