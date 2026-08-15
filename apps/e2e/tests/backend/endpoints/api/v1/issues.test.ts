import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { it } from "../../../../helpers";
import { Auth, Project, flushBackgroundTasks, niceBackendFetch } from "../../../backend-helpers";

/**
 * End-to-end coverage for the Issues surface: `$error` ingest -> server-side
 * grouping -> exactly-once Postgres materialization -> `/internal/issues*`.
 *
 * Three things about this file are load-bearing and easy to break:
 *
 *  1. Issue materialization runs off the request path inside
 *     `runAsynchronouslyAndWaitUntil`, so every assertion about Issue state must
 *     be preceded by `flushBackgroundTasks()`. Without it these tests are
 *     timing-dependent and will pass locally and fail in CI (or vice versa).
 *  2. The `/internal/issues*` routes gate on `apps.installed.observability`,
 *     while the ingest route gates on `apps.installed.analytics`. Both have to be
 *     on, or one half of every test 400s with `ANALYTICS_NOT_ENABLED`.
 *  3. Grouping hashes are deterministic but are NOT asserted literally anywhere
 *     here. They are an implementation detail of `lib/issues/grouping.ts`, and
 *     pinning them in a snapshot would turn every legitimate grouping change
 *     into a diff in this file. Tests assert hash RELATIONSHIPS (same/different)
 *     instead, which is the property the product actually promises.
 */

const TELEMETRY_RESOURCE = {
  service: { namespace: "e2e", name: "issues-e2e", version: "test" },
  deploymentEnvironmentName: "test",
  attributes: { suite: "issues" },
} as const;

/** The events/spans batch body is at schema_version 3 (W3C span identity). */
const BATCH_FIELDS = {
  schema_version: 3,
  resource: TELEMETRY_RESOURCE,
} as const;

// ─── Fixtures ───────────────────────────────────────────────────────────────

/**
 * Two frames from the same browser file. Top-of-stack first, which is the order
 * V8 emits and the order `parseStack` expects.
 *
 * `https://` origin + no `/node_modules/` makes both frames in-app on the
 * `javascript` platform, so the app and system grouping variants agree and the
 * issue owns exactly one hash. That keeps `issue_hashes.length` a stable 1 in
 * the snapshots below.
 */
const CHECKOUT_FRAMES = [
  "doWork (https://app.example.com/static/checkout.js:10:15)",
  "handleClick (https://app.example.com/static/checkout.js:22:3)",
] as const;

const PROFILE_FRAMES = [
  "renderProfile (https://app.example.com/static/profile.js:41:9)",
] as const;

function browserStack(header: string, frames: readonly string[]): string {
  return [header, ...frames.map((frame) => `    at ${frame}`)].join("\n");
}

type ErrorEventOptions = {
  name: string,
  message: string,
  eventAtMs: number,
  stack?: string,
  /**
   * Mirrors what the SDK's `normalizeCapturedError` stamps for a non-`Error`
   * throw. Grouping has a dedicated rule for these, so it must be exercised.
   */
  synthetic?: boolean,
  release?: string,
};

function errorEvent(options: ErrorEventOptions) {
  return {
    event_type: "$error",
    event_at_ms: options.eventAtMs,
    data: {
      name: options.name,
      message: options.message,
      ...options.stack === undefined ? {} : { stack: options.stack },
      ...options.synthetic === true ? { synthetic: true } : {},
      ...options.release === undefined ? {} : { release: options.release },
    },
  };
}

/** A `TypeError` with a two-frame in-app browser stack. */
function checkoutTypeError(eventAtMs: number, message = "cart.total is not a function") {
  return errorEvent({
    name: "TypeError",
    message,
    eventAtMs,
    stack: browserStack(`TypeError: ${message}`, CHECKOUT_FRAMES),
  });
}

// ─── Wiring ─────────────────────────────────────────────────────────────────

/**
 * A fresh project with both apps on and a signed-in user.
 *
 * Path notation rather than a nested `{ apps: { installed: … } }` object: the
 * config override is merged by path, and writing the nested form would replace
 * the whole `apps.installed` map and silently uninstall every other default app.
 */
async function setUpIssuesProject() {
  const created = await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({
    "apps.installed.analytics.enabled": true,
    "apps.installed.observability.enabled": true,
  });
  const user = await Auth.fastSignUp();
  return { ...created, user };
}

type BatchEvent = ReturnType<typeof errorEvent>;

/**
 * Posts a telemetry batch and then drains the background materializer.
 *
 * Returns the batch id so callers can retry the exact same batch (the
 * exactly-once tests) or look the occurrences up in ClickHouse by it.
 */
async function postBatch(options: { events: BatchEvent[], batchId?: string, sentAtMs?: number }) {
  const batchId = options.batchId ?? randomUUID();
  const response = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      ...BATCH_FIELDS,
      session_replay_segment_id: randomUUID(),
      batch_id: batchId,
      sent_at_ms: options.sentAtMs ?? Date.now(),
      events: options.events,
    },
  });
  if (response.status !== 200) {
    throw new HexclaveAssertionError("Telemetry batch upload failed", { response });
  }
  // Issue materialization is fire-and-forget via `runAsynchronouslyAndWaitUntil`.
  // Every Issue assertion in this file depends on this line.
  await flushBackgroundTasks();
  return { batchId, response };
}

function issuesUrl(query: Record<string, string> = {}) {
  const search = new URLSearchParams(query).toString();
  return `/api/v1/internal/issues${search === "" ? "" : `?${search}`}`;
}

async function listIssues(query: Record<string, string> = {}) {
  return await niceBackendFetch(issuesUrl(query), { method: "GET", accessType: "admin" });
}

async function getIssue(issueId: string, query: Record<string, string> = {}) {
  const search = new URLSearchParams(query).toString();
  return await niceBackendFetch(
    `/api/v1/internal/issues/${encodeURIComponent(issueId)}${search === "" ? "" : `?${search}`}`,
    { method: "GET", accessType: "admin" },
  );
}

async function patchIssue(issueId: string, body: { status: string, ignored_until_millis?: number | null }) {
  return await niceBackendFetch(`/api/v1/internal/issues/${encodeURIComponent(issueId)}`, {
    method: "PATCH",
    accessType: "admin",
    body,
  });
}

async function queryAnalytics(query: string, params: Record<string, unknown> = {}) {
  return await niceBackendFetch("/api/v1/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: { query, params },
  });
}

function analyticsRows(response: { status: number, body?: unknown }): Record<string, unknown>[] {
  if (response.status !== 200) {
    throw new HexclaveAssertionError("Analytics query failed", { response });
  }
  const body = response.body;
  const result = typeof body === "object" && body !== null && "result" in body ? (body as { result: unknown }).result : null;
  if (!Array.isArray(result)) {
    throw new HexclaveAssertionError("Analytics query did not return a result array", { response });
  }
  return result.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
}

type ListedIssue = {
  id: string,
  short_id: string,
  type: string,
  value: string,
  culprit: string,
  status: string,
  substatus: string,
  times_seen: string,
  counters_truncated_at_millis: number | null,
  window_occurrences: number,
  window_users: number,
  service_name: string | null,
  environment: string | null,
  release: string | null,
  first_seen_at_millis: number,
  last_seen_at_millis: number,
  issue_hashes: string[],
};

function itemsOf(response: { status: number, body?: any }): ListedIssue[] {
  if (response.status !== 200) {
    throw new HexclaveAssertionError("Issue list request failed", { response });
  }
  const items = response.body?.items;
  if (!Array.isArray(items)) {
    throw new HexclaveAssertionError("Issue list response had no items array", { response });
  }
  return items as ListedIssue[];
}

function onlyItem(response: { status: number, body?: any }): ListedIssue {
  const items = itemsOf(response);
  if (items.length !== 1) {
    throw new HexclaveAssertionError(`Expected exactly one issue, got ${items.length}`, { response });
  }
  return items[0];
}

/**
 * Projection used for inline snapshots.
 *
 * `first_seen_at_millis` / `last_seen_at_millis` / `id` / `issue_hashes` are
 * omitted because they are wall-clock- or hash-dependent; the snapshot
 * serializer strips UUIDs and `updated_at_millis` but knows nothing about these.
 * Tests that care about them assert on them directly.
 */
function summarize(issue: ListedIssue) {
  return {
    short_id: issue.short_id,
    type: issue.type,
    value: issue.value,
    culprit: issue.culprit,
    status: issue.status,
    substatus: issue.substatus,
    times_seen: issue.times_seen,
    counters_truncated_at_millis: issue.counters_truncated_at_millis,
    window_occurrences: issue.window_occurrences,
    window_users: issue.window_users,
    service_name: issue.service_name,
    environment: issue.environment,
    owned_hash_count: issue.issue_hashes.length,
  };
}

/** Mirrors `computeOccurrenceId` in `lib/analytics-telemetry-writers.ts`. */
function expectedOccurrenceId(batchId: string, ordinal: number): string {
  return createHash("sha256").update(`${batchId}:${ordinal}`, "utf8").digest("hex").slice(0, 32);
}

function internalDatabaseConnectionString(): string {
  const connectionString = getEnvVariable(
    "HEXCLAVE_DATABASE_CONNECTION_STRING",
    getEnvVariable("STACK_DATABASE_CONNECTION_STRING", ""),
  );
  if (connectionString === "") {
    throw new HexclaveAssertionError("Issue E2E tests require a configured internal database connection string");
  }
  return connectionString;
}

async function withInternalDatabase<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: internalDatabaseConnectionString(),
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// ─── Gating and access control ──────────────────────────────────────────────

it("returns ANALYTICS_NOT_ENABLED when the observability app is not installed", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  // Analytics on, observability off: the ingest half would work, the read half must not.
  await Project.updateConfig({ "apps.installed.analytics.enabled": true });

  const res = await listIssues();
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ANALYTICS_NOT_ENABLED",
        "error": "Analytics is not enabled for this project.",
      },
      "headers": Headers {
        "x-stack-known-error": "ANALYTICS_NOT_ENABLED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects non-admin access to the issues endpoints", async ({ expect }) => {
  await setUpIssuesProject();

  const clientRes = await niceBackendFetch(issuesUrl(), { method: "GET", accessType: "client" });
  expect(clientRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INSUFFICIENT_ACCESS_TYPE",
        "details": {
          "actual_access_type": "client",
          "allowed_access_types": ["admin"],
        },
        "error": "The x-hexclave-access-type header must be 'admin', but was 'client'. (The legacy x-stack-access-type header is also accepted.)",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);

  const serverRes = await niceBackendFetch(issuesUrl(), { method: "GET", accessType: "server" });
  expect(serverRes.status).toBe(401);
  expect(serverRes.body?.code).toBe("INSUFFICIENT_ACCESS_TYPE");
});

// ─── Grouping / ingest ──────────────────────────────────────────────────────

it("stamps grouping columns and a deterministic occurrence_id onto ingested $error rows", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  const { batchId } = await postBatch({ events: [checkoutTypeError(now)] });

  const rows = analyticsRows(await queryAnalytics(
    `SELECT occurrence_id, batch_id, event_type, error_type, error_culprit, message, level,
            issue_hash, length(issue_hashes) AS owned_hash_count, issue_grouping_config, issue_variant, grouping_degraded
     FROM errors
     WHERE batch_id = {batchId:String}`,
    { batchId },
  ));
  expect(rows).toHaveLength(1);
  const row = rows[0];

  // `occurrence_id` is sha256(batch_id ‖ ordinal), which is what makes a retried
  // batch produce byte-identical occurrence identities in both stores.
  expect(row.occurrence_id).toBe(expectedOccurrenceId(batchId, 0));
  expect(row.issue_hash).toMatch(/^[0-9a-f]{32}$/);

  expect({
    event_type: row.event_type,
    error_type: row.error_type,
    error_culprit: row.error_culprit,
    // `message`/`level` are promoted out of `data` SERVER-side for `$error`; the
    // wire schema forbids the client from sending them on anything but `$log`.
    message: row.message,
    level: row.level,
    owned_hash_count: row.owned_hash_count,
    issue_grouping_config: row.issue_grouping_config,
    issue_variant: row.issue_variant,
    grouping_degraded: row.grouping_degraded,
  }).toMatchInlineSnapshot(`
    {
      "error_culprit": "doWork (/static/checkout.js)",
      "error_type": "TypeError",
      "event_type": "$error",
      "grouping_degraded": 0,
      "issue_grouping_config": "hexclave-js:2026-08-01",
      "issue_variant": "system",
      "level": "error",
      "message": "cart.total is not a function",
      "owned_hash_count": 1,
    }
  `);

  // The parsed frames are what the detail view renders.
  const detail = await getIssue(onlyItem(await listIssues()).id);
  expect(detail.status).toBe(200);
  expect(detail.body?.occurrence?.frames).toMatchInlineSnapshot(`
    [
      {
        "abs_path": "https://app.example.com/static/checkout.js",
        "colno": 3,
        "filename": "/static/checkout.js",
        "function": "handleClick",
        "in_app": true,
        "lineno": 22,
        "module": "static/checkout",
      },
      {
        "abs_path": "https://app.example.com/static/checkout.js",
        "colno": 15,
        "filename": "/static/checkout.js",
        "function": "doWork",
        "in_app": true,
        "lineno": 10,
        "module": "static/checkout",
      },
    ]
  `);
});

it("collapses two occurrences of the same error into one issue", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  // Two DIFFERENT batches (so the ledger does not dedupe them) carrying the same error.
  await postBatch({ events: [checkoutTypeError(now)] });
  await postBatch({ events: [checkoutTypeError(now + 1_000)] });

  const issue = onlyItem(await listIssues());
  expect(summarize(issue)).toMatchInlineSnapshot(`
    {
      "counters_truncated_at_millis": null,
      "culprit": "doWork (/static/checkout.js)",
      "environment": "test",
      "owned_hash_count": 1,
      "service_name": "issues-e2e",
      "short_id": "1",
      "status": "unresolved",
      "substatus": "new",
      "times_seen": "2",
      "type": "TypeError",
      "value": "cart.total is not a function",
      "window_occurrences": 2,
      "window_users": 1,
    }
  `);
  expect(issue.last_seen_at_millis).toBe(now + 1_000);
  expect(issue.first_seen_at_millis).toBe(now);
});

/**
 * Regression test for a real grouping bug caught in review: the exception type
 * has to be a hashed leaf. Without it, a `TypeError` and a `RangeError` thrown
 * from the same helper share every other leaf and collapse into one issue —
 * which is wrong, because they are different bugs with different fixes.
 */
it("does not merge a TypeError and a RangeError thrown from the same frame", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  const message = "value out of bounds";
  await postBatch({
    events: [
      errorEvent({ name: "TypeError", message, eventAtMs: now, stack: browserStack(`TypeError: ${message}`, CHECKOUT_FRAMES) }),
      errorEvent({ name: "RangeError", message, eventAtMs: now, stack: browserStack(`RangeError: ${message}`, CHECKOUT_FRAMES) }),
    ],
  });

  const items = itemsOf(await listIssues());
  expect(items).toHaveLength(2);
  // Different owning hashes is the actual claim; two rows could otherwise be an
  // artifact of pagination or of the list query rather than of grouping.
  expect(new Set(items.flatMap((item) => item.issue_hashes)).size).toBe(2);
  expect(items.map((item) => ({ type: item.type, culprit: item.culprit, times_seen: item.times_seen })).sort((a, b) => stringCompare(a.type, b.type))).toMatchInlineSnapshot(`
    [
      {
        "culprit": "doWork (/static/checkout.js)",
        "times_seen": "1",
        "type": "RangeError",
      },
      {
        "culprit": "doWork (/static/checkout.js)",
        "times_seen": "1",
        "type": "TypeError",
      },
    ]
  `);
});

/**
 * `normalizeCapturedError` forces `name = "Error"` and synthesizes a stack for
 * every non-`Error` throw, so without the dedicated synthetic rule every
 * `throw "nope"` in a project would collapse into one useless issue.
 */
it("does not merge two different non-Error (synthetic) throws", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  const syntheticStack = browserStack("Error: thrown value", PROFILE_FRAMES);
  await postBatch({
    events: [
      errorEvent({ name: "Error", message: "Non-Error thrown: payment declined", eventAtMs: now, stack: syntheticStack, synthetic: true }),
      errorEvent({ name: "Error", message: "Non-Error thrown: session expired", eventAtMs: now, stack: syntheticStack, synthetic: true }),
    ],
  });

  const items = itemsOf(await listIssues());
  expect(items).toHaveLength(2);
  expect(new Set(items.flatMap((item) => item.issue_hashes)).size).toBe(2);
  expect(items.map((item) => item.value).sort()).toMatchInlineSnapshot(`
    [
      "Non-Error thrown: payment declined",
      "Non-Error thrown: session expired",
    ]
  `);

  // ...but two occurrences of the SAME synthetic throw still collapse.
  await postBatch({
    events: [errorEvent({ name: "Error", message: "Non-Error thrown: payment declined", eventAtMs: now + 1_000, stack: syntheticStack, synthetic: true })],
  });
  const after = itemsOf(await listIssues());
  expect(after).toHaveLength(2);
  expect(after.map((item) => item.times_seen).sort()).toEqual(["1", "2"]);
});

// ─── Exactly-once materialization ───────────────────────────────────────────

/**
 * The whole contract of `IssueMaterialization`. A batch that reaches Postgres
 * twice (a retry that ClickHouse deduplicated by insert token) must advance the
 * counters exactly once.
 */
it("increments times_seen exactly once when the same batch_id is posted twice", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  const batchId = randomUUID();
  const events = [checkoutTypeError(now)];

  await postBatch({ batchId, events });
  const afterFirst = onlyItem(await listIssues());
  expect(afterFirst.times_seen).toBe("1");

  // Byte-identical retry of the same batch.
  await postBatch({ batchId, events });
  const afterRetry = onlyItem(await listIssues());

  expect({ times_seen: afterRetry.times_seen, substatus: afterRetry.substatus }).toMatchInlineSnapshot(`
    {
      "substatus": "new",
      "times_seen": "1",
    }
  `);
  expect(afterRetry.id).toBe(afterFirst.id);
  expect(afterRetry.short_id).toBe(afterFirst.short_id);

  // Exactly one ledger row for the batch, which is what made the second run a no-op.
  const ledgerRows = await withInternalDatabase(async (client) => {
    return await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "IssueMaterialization" WHERE "batchId" = $1::uuid`,
      [batchId],
    );
  });
  expect(ledgerRows.rows[0].count).toBe("1");
});

/**
 * KNOWN BUG — marked `.fails` so the suite stays green while the defect stays
 * visible. Delete the `.fails` (do not delete the test) once it is fixed;
 * vitest then reports it as failing-because-it-passed, which is the reminder.
 *
 * The Postgres LIFETIME counter is exactly-once (see the test above), but the
 * ClickHouse WINDOW counter is not: `analytics_internal.logs` carries
 * `non_replicated_deduplication_window = 10000`, so the retried batch is
 * deduplicated at the source table — but the server runs with
 * `deduplicate_blocks_in_dependent_materialized_views = 0` (the ClickHouse
 * default), so the block that `issue_occurrence_rollup_mv` pushes into
 * `analytics_internal.issue_occurrence_rollup` is NOT deduplicated and the
 * retry is counted again.
 *
 * The result is a list row whose lifetime count says 1 and whose 24h count says
 * 2 for the same occurrence. The comment on `insertBatchEvents` in
 * `lib/analytics-telemetry-writers.ts` asserts the opposite ("Synchronous
 * inserts preserve dependent-view deduplication"), which is what makes this
 * worth pinning: the code believes it is already handled.
 *
 * Every other `TO`-table materialized view fed by a deduplicated insert
 * (`span_writes_mv`, `trace_roots_mv`, `trace_services_mv`, `clickmap_events_mv`)
 * has the same exposure.
 */
it.fails("does not inflate window_occurrences when the same batch is retried", async ({ expect }) => {
  await setUpIssuesProject();

  const batchId = randomUUID();
  const events = [checkoutTypeError(Date.now())];
  await postBatch({ batchId, events });
  await postBatch({ batchId, events });

  expect(onlyItem(await listIssues()).window_occurrences).toBe(1);
});

it("produces a byte-identical occurrence_id across retries of the same batch", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  const batchId = randomUUID();
  const events = [checkoutTypeError(now), checkoutTypeError(now + 1, "other failure")];

  await postBatch({ batchId, events });
  const first = analyticsRows(await queryAnalytics(
    `SELECT occurrence_id FROM errors WHERE batch_id = {batchId:String} ORDER BY occurrence_id`,
    { batchId },
  )).map((row) => row.occurrence_id);

  await postBatch({ batchId, events });
  const second = analyticsRows(await queryAnalytics(
    `SELECT occurrence_id FROM errors WHERE batch_id = {batchId:String} ORDER BY occurrence_id`,
    { batchId },
  )).map((row) => row.occurrence_id);

  // ClickHouse deduplicated the retry by insert token, so the row count is
  // unchanged AND the ids are the same values, not merely the same count.
  expect(second).toEqual(first);
  expect(new Set(first).size).toBe(2);
  expect(new Set(first)).toEqual(new Set([expectedOccurrenceId(batchId, 0), expectedOccurrenceId(batchId, 1)]));
});

// ─── Lifecycle ──────────────────────────────────────────────────────────────

it("reopens a resolved issue as regressed when a new occurrence arrives", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  await postBatch({ events: [checkoutTypeError(now)] });
  const issue = onlyItem(await listIssues());

  const patchRes = await patchIssue(issue.id, { status: "resolved" });
  expect(patchRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "id": "<stripped UUID>",
        "status": "resolved",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  expect(itemsOf(await listIssues({ status: "unresolved" }))).toHaveLength(0);
  expect(onlyItem(await listIssues({ status: "resolved" })).status).toBe("resolved");

  await postBatch({ events: [checkoutTypeError(now + 1_000)] });

  const regressed = onlyItem(await listIssues({ status: "unresolved" }));
  expect({ status: regressed.status, substatus: regressed.substatus, times_seen: regressed.times_seen }).toMatchInlineSnapshot(`
    {
      "status": "unresolved",
      "substatus": "regressed",
      "times_seen": "2",
    }
  `);
});

/**
 * Regression detection compares SERVER RECEIPT TIME against `resolvedAt`, never
 * the client-supplied `event_at_ms` — a client with a fast clock would otherwise
 * be able to reopen a resolved issue, and one with a slow clock could hide a
 * real regression.
 *
 * So a back-dated occurrence that ARRIVES after the resolve still regresses the
 * issue (it is a real recurrence, whatever the reporter's clock says), while the
 * lifetime counters honour the client timestamps: `lastSeenAt` uses `GREATEST`
 * and therefore does not move backwards, and `firstSeenAt` uses `LEAST` and does.
 */
it("regresses on server receipt time, not on the client clock, for a back-dated occurrence", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  await postBatch({ events: [checkoutTypeError(now)] });
  const issue = onlyItem(await listIssues());
  expect((await patchIssue(issue.id, { status: "resolved" })).status).toBe(200);

  // Client timestamp two hours BEFORE the resolve — but received after it.
  const backdatedAtMs = now - 2 * 60 * 60 * 1000;
  await postBatch({ events: [checkoutTypeError(backdatedAtMs)] });

  const after = onlyItem(await listIssues({ status: "all" }));
  expect({ status: after.status, substatus: after.substatus, times_seen: after.times_seen }).toMatchInlineSnapshot(`
    {
      "status": "unresolved",
      "substatus": "regressed",
      "times_seen": "2",
    }
  `);
  // The client clock only moves the counters, and only in the direction that
  // widens the interval.
  expect(after.last_seen_at_millis).toBe(now);
  expect(after.first_seen_at_millis).toBe(backdatedAtMs);
});

/**
 * The stored `IGNORED -> UNRESOLVED` flip is lazy: it happens inside the ingest
 * `UPDATE`, deliberately, because an ignored issue that never recurs *should*
 * stay ignored and a cron waking them all up would be wrong. The read path
 * therefore has to compensate for the window in between.
 */
it("reports an issue whose snooze has expired as unresolved before the next occurrence", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  await postBatch({ events: [checkoutTypeError(now)] });
  const issue = onlyItem(await listIssues());

  const patchRes = await patchIssue(issue.id, { status: "ignored", ignored_until_millis: now - 60_000 });
  expect(patchRes.status).toBe(200);

  // `status=all` rather than `status=unresolved`: the list's status FILTER runs
  // against the stored column, so the row is still found under `ignored`, while
  // the item's reported status has already been compensated. The read path
  // applies that compensation consistently across items, counts, and the status
  // filter, which is the behaviour under test.
  const listed = onlyItem(await listIssues({ status: "all" }));
  expect(listed.status).toBe("unresolved");

  const detail = await getIssue(issue.id);
  expect(detail.status).toBe(200);
  expect(detail.body?.issue?.status).toBe("unresolved");

  // The counts apply the SAME lapsed-snooze compensation as the items, so the
  // tab badge agrees with the row it is counting. Counting the raw stored column
  // instead would render "ignored: 1" next to a row the same response describes
  // as unresolved, which reads as a bug to anyone looking at the screen.
  expect((await listIssues({ status: "all" })).body?.counts).toMatchInlineSnapshot(`
    {
      "ignored": 0,
      "resolved": 0,
      "unresolved": 1,
    }
  `);

  // ...and the status FILTER agrees too, so an issue the list calls unresolved
  // is actually findable under `?status=unresolved`.
  expect(itemsOf(await listIssues({ status: "unresolved" }))).toHaveLength(1);
  expect(itemsOf(await listIssues({ status: "ignored" }))).toHaveLength(0);

  // A snooze that has NOT expired is reported as ignored.
  expect((await patchIssue(issue.id, { status: "ignored", ignored_until_millis: now + 60 * 60 * 1000 })).status).toBe(200);
  expect(onlyItem(await listIssues({ status: "all" })).status).toBe("ignored");

  // Ignoring forever (no `ignored_until_millis`) also stays ignored.
  expect((await patchIssue(issue.id, { status: "ignored" })).status).toBe(200);
  expect(onlyItem(await listIssues({ status: "all" })).status).toBe("ignored");
});

// ─── API shape ──────────────────────────────────────────────────────────────

/**
 * `Issue.shortId` and `Issue.timesSeen` are Postgres `BigInt`, and
 * `smart-response.tsx` runs `JSON.stringify` over the body — which THROWS on a
 * BigInt rather than coercing it. If either ever stops being serialized as a
 * decimal string, the very first list response 500s. This is that guard, not a
 * style assertion.
 */
it("returns short_id and times_seen as strings, not numbers", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  await postBatch({ events: [checkoutTypeError(now)] });
  await postBatch({ events: [checkoutTypeError(now + 1_000)] });

  const listed = onlyItem(await listIssues());
  expect(typeof listed.short_id).toBe("string");
  expect(typeof listed.times_seen).toBe("string");
  expect({ short_id: listed.short_id, times_seen: listed.times_seen }).toMatchInlineSnapshot(`
    {
      "short_id": "1",
      "times_seen": "2",
    }
  `);

  const detail = await getIssue(listed.id);
  expect(detail.status).toBe(200);
  expect(typeof detail.body?.issue?.short_id).toBe("string");
  expect(typeof detail.body?.issue?.times_seen).toBe("string");
});

it("resolves the detail route by uuid, by numeric short id, and through an IssueRedirect", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  await postBatch({ events: [checkoutTypeError(now)] });
  const issue = onlyItem(await listIssues());

  const byUuid = await getIssue(issue.id);
  expect(byUuid.status).toBe(200);
  expect(byUuid.body?.issue?.id).toBe(issue.id);
  expect(byUuid.body?.redirected_from_issue_id).toBe(null);

  const byShortId = await getIssue(issue.short_id);
  expect(byShortId.status).toBe(200);
  expect(byShortId.body?.issue?.id).toBe(issue.id);

  // A merged-away id. Merge is not wired to a route yet, so the redirect row is
  // seeded directly — the behaviour under test belongs to the detail route, not
  // to merge.
  const mergedAwayIssueId = randomUUID();
  await withInternalDatabase(async (client) => {
    const tenancies = await client.query<{ tenancyId: string }>(
      `SELECT "tenancyId" FROM "Issue" WHERE "id" = $1::uuid`,
      [issue.id],
    );
    if (tenancies.rows.length !== 1) {
      throw new HexclaveAssertionError("Expected exactly one Issue row for the seeded issue");
    }
    await client.query(
      `INSERT INTO "IssueRedirect" ("tenancyId", "fromIssueId", "toIssueId", "fromShortId")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
      [tenancies.rows[0].tenancyId, mergedAwayIssueId, issue.id, "9999"],
    );
  });

  const byRedirect = await getIssue(mergedAwayIssueId);
  expect(byRedirect.status).toBe(200);
  expect(byRedirect.body?.issue?.id).toBe(issue.id);
  expect(byRedirect.body?.redirected_from_issue_id).toBe(mergedAwayIssueId);

  // An id that is neither a uuid nor all-digits is a client error, not a 404.
  const malformed = await getIssue("not-an-id");
  expect(malformed).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "issue_id must be a UUID or a numeric short id",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const missing = await getIssue(randomUUID());
  expect(missing).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "Issue not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

/**
 * Tenant isolation for these routes comes from the explicit tenancy predicate in
 * `issue-queries.ts` / the detail route, NOT from a ClickHouse row policy (the
 * issues reads use the admin client). So it has to be asserted end to end, and
 * the failure mode to guard against is a 200 with another project's data — a 404
 * is the only acceptable answer, including for the write path.
 */
it("cannot read or mutate another project's issue", async ({ expect }) => {
  await setUpIssuesProject();
  const now = Date.now();
  await postBatch({ events: [checkoutTypeError(now)] });
  const projectAIssue = onlyItem(await listIssues());

  await setUpIssuesProject();
  await postBatch({ events: [errorEvent({ name: "Error", message: "project B only", eventAtMs: now, stack: browserStack("Error: project B only", PROFILE_FRAMES) })] });
  const projectBIssue = onlyItem(await listIssues());
  expect(projectBIssue.id).not.toBe(projectAIssue.id);
  // Short ids are per-tenancy, so both projects have a `1`. Reading `1` from B
  // must return B's issue, never A's.
  expect(projectBIssue.short_id).toBe("1");
  expect((await getIssue("1")).body?.issue?.id).toBe(projectBIssue.id);

  const crossRead = await getIssue(projectAIssue.id);
  expect(crossRead).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "Issue not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const crossWrite = await patchIssue(projectAIssue.id, { status: "resolved" });
  expect(crossWrite).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "Issue not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("filters the issue list by status, service, and environment", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  await postBatch({
    events: [
      checkoutTypeError(now),
      errorEvent({ name: "ReferenceError", message: "profile is not defined", eventAtMs: now, stack: browserStack("ReferenceError: profile is not defined", PROFILE_FRAMES) }),
    ],
  });

  const all = itemsOf(await listIssues({ status: "all" }));
  expect(all).toHaveLength(2);
  const resolvedTarget = all.find((item) => item.type === "TypeError") ?? throwMissing("TypeError issue");
  expect((await patchIssue(resolvedTarget.id, { status: "resolved" })).status).toBe(200);

  expect(itemsOf(await listIssues({ status: "unresolved" })).map((item) => item.type)).toEqual(["ReferenceError"]);
  expect(itemsOf(await listIssues({ status: "resolved" })).map((item) => item.type)).toEqual(["TypeError"]);
  expect(itemsOf(await listIssues({ status: "ignored" }))).toHaveLength(0);

  const allRes = await listIssues({ status: "all" });
  expect(allRes.body?.counts).toMatchInlineSnapshot(`
    {
      "ignored": 0,
      "resolved": 1,
      "unresolved": 1,
    }
  `);
  // The candidate set is far below `ISSUE_RANK_CANDIDATE_CAP`, so the ranking is
  // exact. The FIELD must still be present — the dashboard renders it, and a
  // missing key would be indistinguishable from "exact" on the client.
  expect(allRes.body?.approximate).toBe(false);
  expect(allRes.body?.cursor).toBe(null);

  // Service / environment filters are occurrence-scoped and applied in
  // ClickHouse, so an issue with no rollup rows under the filter drops out.
  expect(itemsOf(await listIssues({ status: "all", service: "issues-e2e" }))).toHaveLength(2);
  expect(itemsOf(await listIssues({ status: "all", service: "some-other-service" }))).toHaveLength(0);
  expect(itemsOf(await listIssues({ status: "all", environment: "test" }))).toHaveLength(2);
  expect(itemsOf(await listIssues({ status: "all", environment: "production" }))).toHaveLength(0);

  // Search matches the denormalized display fields the list actually renders.
  expect(itemsOf(await listIssues({ status: "all", search: "profile" })).map((item) => item.type)).toEqual(["ReferenceError"]);
  expect(itemsOf(await listIssues({ status: "all", search: "nothing-matches-this" }))).toHaveLength(0);

  // Window-scoped sorts take the ClickHouse ranking path rather than the
  // Postgres keyset path, so they need their own coverage.
  expect(itemsOf(await listIssues({ status: "all", sort: "events" }))).toHaveLength(2);
  expect((await listIssues({ status: "all", sort: "events" })).body?.approximate).toBe(false);
});

it("validates issue list query parameters", async ({ expect }) => {
  await setUpIssuesProject();

  expect(await listIssues({ hours: "3" })).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "hours must be one of 1, 24, 168, 720",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  expect(await listIssues({ status: "bogus" })).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "status must be one of unresolved, resolved, ignored, all",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  expect(await listIssues({ sort: "bogus" })).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "sort must be one of last_seen, first_seen, events, users",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  expect(await listIssues({ handled: "bogus" })).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "handled must be one of all, handled, unhandled",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  expect(await listIssues({ limit: "0" })).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "limit must be a positive integer",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  // Accepted values still round-trip.
  expect((await listIssues({ hours: "720", status: "all", sort: "users", sort_dir: "asc", limit: "10", handled: "handled" })).status).toBe(200);
});

it("paginates the issue list with a keyset cursor", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  await postBatch({
    events: [
      checkoutTypeError(now),
      errorEvent({ name: "ReferenceError", message: "profile is not defined", eventAtMs: now + 1_000, stack: browserStack("ReferenceError: profile is not defined", PROFILE_FRAMES) }),
    ],
  });

  const first = await listIssues({ status: "all", limit: "1" });
  expect(itemsOf(first)).toHaveLength(1);
  const cursor = first.body?.cursor;
  if (typeof cursor !== "string") {
    throw new HexclaveAssertionError("Expected a next-page cursor", { response: first });
  }

  const second = await listIssues({ status: "all", limit: "1", cursor });
  expect(itemsOf(second)).toHaveLength(1);
  expect(itemsOf(second)[0].id).not.toBe(itemsOf(first)[0].id);
  expect(second.body?.cursor).toBe(null);
});

it("navigates an issue's occurrences with the older/newer cursors", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  await postBatch({ events: [checkoutTypeError(now)] });
  await postBatch({ events: [checkoutTypeError(now + 5_000)] });

  const issue = onlyItem(await listIssues());
  const newest = await getIssue(issue.id);
  expect(newest.status).toBe(200);
  // Default direction is "older", so the first page is the most recent occurrence.
  expect(newest.body?.occurrence?.event_at_millis).toBe(now + 5_000);
  expect(newest.body?.occurrence?.message).toBe("cart.total is not a function");
  expect(newest.body?.occurrence?.raw_stack).toContain("at doWork (https://app.example.com/static/checkout.js:10:15)");

  const olderCursor = newest.body?.older_cursor;
  if (typeof olderCursor !== "string") {
    throw new HexclaveAssertionError("Expected an older cursor", { response: newest });
  }
  const older = await getIssue(issue.id, { occurrence: olderCursor, direction: "older" });
  expect(older.status).toBe(200);
  expect(older.body?.occurrence?.event_at_millis).toBe(now);
});

// ─── Merge / unmerge ────────────────────────────────────────────────────────
//
// `lib/issues/issue-merge.ts` exists but `POST /internal/issues/merge` and
// `POST /internal/issues/[issue_id]/unmerge` are not wired up yet. The bodies
// below are written against the shapes in `shared/interface/admin-issues.ts`
// (`IssueMergeRequestSchema` / `IssueUnmergeRequestSchema`) and should need
// nothing but the `.todo` removed once the routes land.

it("merges issues, picking the primary by (firstSeenAt asc, timesSeen desc, id asc) and summing lifetime counters", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  // The OLDER issue must win, and it must win on lifetime counters rather than
  // on a ClickHouse window snapshot — so the loser deliberately has more
  // occurrences than the winner.
  await postBatch({ events: [checkoutTypeError(now - 60_000)] });
  await postBatch({
    events: [
      errorEvent({ name: "ReferenceError", message: "profile is not defined", eventAtMs: now, stack: browserStack("ReferenceError: profile is not defined", PROFILE_FRAMES) }),
      errorEvent({ name: "ReferenceError", message: "profile is not defined", eventAtMs: now + 1, stack: browserStack("ReferenceError: profile is not defined", PROFILE_FRAMES) }),
    ],
  });

  const items = itemsOf(await listIssues({ status: "all" }));
  expect(items).toHaveLength(2);
  const older = items.find((item) => item.type === "TypeError") ?? throwMissing("TypeError issue");
  const newer = items.find((item) => item.type === "ReferenceError") ?? throwMissing("ReferenceError issue");

  const mergeRes = await niceBackendFetch("/api/v1/internal/issues/merge", {
    method: "POST",
    accessType: "admin",
    body: { issue_ids: [newer.id, older.id] },
  });
  expect(mergeRes.status).toBe(200);
  expect(mergeRes.body?.primary_issue_id).toBe(older.id);
  expect(mergeRes.body?.merged_issue_ids).toEqual([newer.id]);

  const merged = onlyItem(await listIssues({ status: "all" }));
  expect(merged.id).toBe(older.id);
  // 1 (older, lifetime) + 2 (newer, lifetime) — not a window count.
  expect(merged.times_seen).toBe("3");
  expect(merged.issue_hashes).toHaveLength(2);
  expect(merged.counters_truncated_at_millis).toBe(null);

  // The merged-away id stays resolvable, one hop, via IssueRedirect.
  const redirected = await getIssue(newer.id);
  expect(redirected.status).toBe(200);
  expect(redirected.body?.issue?.id).toBe(older.id);
  expect(redirected.body?.redirected_from_issue_id).toBe(newer.id);
});

it("merging into an already-merged issue follows the redirect and creates no chain", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  await postBatch({ events: [checkoutTypeError(now - 120_000)] });
  await postBatch({ events: [errorEvent({ name: "ReferenceError", message: "profile is not defined", eventAtMs: now - 60_000, stack: browserStack("ReferenceError: profile is not defined", PROFILE_FRAMES) })] });
  await postBatch({ events: [errorEvent({ name: "SyntaxError", message: "unexpected token", eventAtMs: now, stack: browserStack("SyntaxError: unexpected token", PROFILE_FRAMES) })] });

  const items = itemsOf(await listIssues({ status: "all" }));
  const first = items.find((item) => item.type === "TypeError") ?? throwMissing("TypeError issue");
  const second = items.find((item) => item.type === "ReferenceError") ?? throwMissing("ReferenceError issue");
  const third = items.find((item) => item.type === "SyntaxError") ?? throwMissing("SyntaxError issue");

  const firstMerge = await niceBackendFetch("/api/v1/internal/issues/merge", {
    method: "POST", accessType: "admin", body: { issue_ids: [first.id, second.id] },
  });
  expect(firstMerge.body?.primary_issue_id).toBe(first.id);

  // Merging the third issue INTO the already-merged-away id must land on the
  // surviving primary and must not create a two-hop chain.
  const secondMerge = await niceBackendFetch("/api/v1/internal/issues/merge", {
    method: "POST", accessType: "admin", body: { issue_ids: [second.id, third.id] },
  });
  expect(secondMerge.status).toBe(200);
  expect(secondMerge.body?.primary_issue_id).toBe(first.id);

  const redirects = await withInternalDatabase(async (client) => {
    return await client.query<{ fromIssueId: string, toIssueId: string }>(
      `SELECT "fromIssueId", "toIssueId" FROM "IssueRedirect" WHERE "toIssueId" = $1::uuid OR "fromIssueId" = $1::uuid`,
      [first.id],
    );
  });
  // Every redirect points DIRECTLY at the surviving primary; none points at a
  // merged-away id (which would be a chain).
  expect(redirects.rows.every((row) => row.toIssueId === first.id)).toBe(true);
  expect(new Set(redirects.rows.map((row) => row.fromIssueId))).toEqual(new Set([second.id, third.id]));
});

it("unmerge is retroactive: historical occurrences owned by the split hash resolve to the new issue", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  await postBatch({ events: [checkoutTypeError(now - 60_000)] });
  await postBatch({ events: [errorEvent({ name: "ReferenceError", message: "profile is not defined", eventAtMs: now, stack: browserStack("ReferenceError: profile is not defined", PROFILE_FRAMES) })] });

  const before = itemsOf(await listIssues({ status: "all" }));
  const older = before.find((item) => item.type === "TypeError") ?? throwMissing("TypeError issue");
  const newer = before.find((item) => item.type === "ReferenceError") ?? throwMissing("ReferenceError issue");
  const splitHash = newer.issue_hashes[0];

  await niceBackendFetch("/api/v1/internal/issues/merge", {
    method: "POST", accessType: "admin", body: { issue_ids: [older.id, newer.id] },
  });

  // Before the unmerge, the merged issue serves BOTH occurrences.
  const mergedDetail = await getIssue(older.id);
  expect(mergedDetail.body?.occurrence?.event_at_millis).toBe(now);

  const unmergeRes = await niceBackendFetch(`/api/v1/internal/issues/${encodeURIComponent(older.id)}/unmerge`, {
    method: "POST", accessType: "admin", body: { hashes: [splitHash] },
  });
  expect(unmergeRes.status).toBe(200);
  expect(unmergeRes.body?.source_issue_id).toBe(older.id);
  const newIssueId = unmergeRes.body?.new_issue_id;
  if (typeof newIssueId !== "string") {
    throw new HexclaveAssertionError("Unmerge did not return a new issue id", { response: unmergeRes });
  }

  // THE property that distinguishes this design from Sentry's: occurrences are
  // stored with their immutable `issue_hash`, not with a mutable issue id, so
  // history follows the hash retroactively rather than staying with the issue it
  // happened to be filed under at ingest time.
  const newDetail = await getIssue(newIssueId);
  expect(newDetail.status).toBe(200);
  expect(newDetail.body?.occurrence?.event_at_millis).toBe(now);
  expect(newDetail.body?.issue?.issue_hashes).toEqual([splitHash]);

  const sourceDetail = await getIssue(older.id);
  expect(sourceDetail.body?.occurrence?.event_at_millis).toBe(now - 60_000);
  expect(sourceDetail.body?.issue?.issue_hashes).not.toContain(splitHash);
});

it("unmerge stamps counters_truncated_at_millis on the new issue", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  await postBatch({ events: [checkoutTypeError(now - 60_000)] });
  await postBatch({ events: [errorEvent({ name: "ReferenceError", message: "profile is not defined", eventAtMs: now, stack: browserStack("ReferenceError: profile is not defined", PROFILE_FRAMES) })] });

  const before = itemsOf(await listIssues({ status: "all" }));
  const older = before.find((item) => item.type === "TypeError") ?? throwMissing("TypeError issue");
  const newer = before.find((item) => item.type === "ReferenceError") ?? throwMissing("ReferenceError issue");
  const splitHash = newer.issue_hashes[0];

  await niceBackendFetch("/api/v1/internal/issues/merge", {
    method: "POST", accessType: "admin", body: { issue_ids: [older.id, newer.id] },
  });
  const unmergeRes = await niceBackendFetch(`/api/v1/internal/issues/${encodeURIComponent(older.id)}/unmerge`, {
    method: "POST", accessType: "admin", body: { hashes: [splitHash] },
  });
  expect(unmergeRes.status).toBe(200);

  // Lifetime counters genuinely cannot be split — the rollup only retains 90
  // days — so the new issue's counters are seeded from the retained window and
  // say so, rather than presenting an all-time number they cannot back up.
  const truncatedAt = unmergeRes.body?.counters_truncated_at_millis;
  expect(typeof truncatedAt).toBe("number");
  const newIssue = itemsOf(await listIssues({ status: "all" })).find((item) => item.id === unmergeRes.body?.new_issue_id);
  expect(newIssue?.counters_truncated_at_millis).toBe(truncatedAt);
});

it("resolves a merged-away NUMERIC short id through IssueRedirect", async ({ expect }) => {
  await setUpIssuesProject();

  const now = Date.now();
  await postBatch({ events: [checkoutTypeError(now - 60_000)] });
  await postBatch({ events: [errorEvent({ name: "ReferenceError", message: "profile is not defined", eventAtMs: now, stack: browserStack("ReferenceError: profile is not defined", PROFILE_FRAMES) })] });

  const items = itemsOf(await listIssues({ status: "all" }));
  const primary = items.find((item) => item.type === "TypeError") ?? throwMissing("TypeError issue");
  const loser = items.find((item) => item.type === "ReferenceError") ?? throwMissing("ReferenceError issue");
  const loserShortId = loser.short_id;

  const merge = await niceBackendFetch("/api/v1/internal/issues/merge", {
    method: "POST", accessType: "admin", body: { issue_ids: [primary.id, loser.id] },
  });
  expect(merge.status).toBe(200);
  expect(merge.body?.primary_issue_id).toBe(primary.id);

  // Short ids are the ids people actually type and paste into chat, so a
  // merged-away one has to keep resolving or exactly the shared links break.
  // `IssueRedirect.fromShortId` carries its own unique constraint for this.
  const byShortId = await getIssue(loserShortId);
  expect(byShortId.status).toBe(200);
  expect(byShortId.body?.issue?.id).toBe(primary.id);
  expect(byShortId.body?.redirected_from_issue_id).toBe(loser.id);

  // The uuid form of the same merged-away issue resolves identically.
  const byUuid = await getIssue(loser.id);
  expect(byUuid.status).toBe(200);
  expect(byUuid.body?.issue?.id).toBe(primary.id);
});

function throwMissing(what: string): never {
  throw new HexclaveAssertionError(`Expected to find ${what} in the issue list`);
}
