import { describe, expect, expectTypeOf, it } from "vitest";
import { EVENTS_COLUMNS, LOGS_COLUMNS, type ClickhouseColumn, type EventColumnName, type LogColumnName } from "../../scripts/clickhouse-migrations";
import {
  getBatchDestinationDeduplicationToken,
  getEventStorageTable,
  normalizeBatchEvents,
} from "./analytics-telemetry-writers";

/**
 * Bidirectional drift guard between the hand-built insert rows and the ClickHouse
 * column declarations, for BOTH destinations the SDK ingest path writes to.
 *
 * Drift here fails at INSERT time against real ClickHouse, which means SDK
 * telemetry silently stops landing while every unit test stays green.
 */
function expectRowMatchesColumns(row: Record<string, unknown>, columns: readonly ClickhouseColumn[], table: string) {
  const columnNames = new Set(columns.map((column) => column.name));
  for (const key of Object.keys(row)) {
    expect(columnNames.has(key), `insert row for ${table} writes ${JSON.stringify(key)}, which is not a declared column`).toBe(true);
  }
  for (const column of columns) {
    if (column.name in row) continue;
    expect(
      column.default != null,
      `column ${JSON.stringify(column.name)} of ${table} is not written by the insert row and has no DB-side DEFAULT to fall back to`,
    ).toBe(true);
  }
}

const DRIFT_GUARD_CONTEXT = {
  projectId: "project",
  branchId: "branch",
  userId: "user",
  refreshTokenId: null,
  sessionReplayId: null,
  sessionReplaySegmentId: null,
  runtime: "browser" as const,
  resource: { service: { name: "svc" } },
  producer: "sdk" as const,
};

const DRIFT_GUARD_BATCH_ID = "00000000-0000-4000-8000-000000000000";

describe("SDK ingest insert rows vs. ClickHouse column declarations", () => {
  it("product-event rows cover the events table", () => {
    const { productEvents } = normalizeBatchEvents(
      [{ event_type: "checkout_completed", event_at_ms: 1_700_000_000_000, data: {} }],
      DRIFT_GUARD_CONTEXT,
      DRIFT_GUARD_BATCH_ID,
    );
    expectRowMatchesColumns(productEvents[0], EVENTS_COLUMNS, "analytics_internal.events");
    // Same guarantee at compile time.
    expectTypeOf<Exclude<keyof typeof productEvents[number], EventColumnName>>().toEqualTypeOf<never>();
  });

  it("log-occurrence rows cover the logs table", () => {
    const { logOccurrences } = normalizeBatchEvents(
      [{ event_type: "$log", event_at_ms: 1_700_000_000_000, data: {}, message: "m", level: "warn" }],
      DRIFT_GUARD_CONTEXT,
      DRIFT_GUARD_BATCH_ID,
    );
    expectRowMatchesColumns(logOccurrences[0], LOGS_COLUMNS, "analytics_internal.logs");
    expectTypeOf<Exclude<keyof typeof logOccurrences[number], LogColumnName>>().toEqualTypeOf<never>();
  });
});

describe("analytics telemetry storage dispatch", () => {
  it("keeps product events out of observability logs", () => {
    for (const eventType of ["checkout.completed", "$click", "$form-submit"]) {
      expect(getEventStorageTable(eventType)).toBe("analytics_internal.events");
    }
  });

  it("keeps log-shaped occurrences out of product events", () => {
    expect(getEventStorageTable("$log")).toBe("analytics_internal.logs");
    expect(getEventStorageTable("$error")).toBe("analytics_internal.logs");
  });

  it("gives each destination of one wire batch its own idempotency token", () => {
    // The property that matters is DISTINCTNESS, not the exact format: one wire
    // batch fans out to several tables, and a retry must be able to finish only
    // the destination that previously failed. Asserting the concatenated string
    // literal instead just restated the implementation.
    // `as const` so the table names stay their literal types rather than widening
    // to `string`, which the destination parameter deliberately does not accept.
    const tokens = (["analytics_internal.events", "analytics_internal.logs", "analytics_internal.spans"] as const)
      .map((table) => getBatchDestinationDeduplicationToken("batch-1", table));
    expect(new Set(tokens).size).toBe(tokens.length);
    // Distinct across batches too, or a retry of batch-2 would be swallowed as
    // a duplicate of batch-1.
    expect(getBatchDestinationDeduplicationToken("batch-2", "analytics_internal.events"))
      .not.toBe(getBatchDestinationDeduplicationToken("batch-1", "analytics_internal.events"));
  });

  it("stores the enclosing span identity verbatim and dispatches by taxonomy", () => {
    const normalized = normalizeBatchEvents([{
      event_type: "$log",
      event_at_ms: 1_700_000_000_000,
      data: {},
      message: "checkout failed",
      level: "error",
      page_view_span_id: "1111111111111111",
      trace_id: "22222222222222222222222222222222",
      span_id: "3333333333333333",
    }], {
      projectId: "project",
      branchId: "branch",
      userId: "user",
      refreshTokenId: "55555555-5555-4555-8555-555555555555",
      sessionReplayId: "66666666-6666-4666-8666-666666666666",
      sessionReplaySegmentId: "77777777-7777-4777-8777-777777777777",
      runtime: "browser",
      producer: "sdk",
      resource: {
        service: { namespace: "commerce", name: "storefront", version: "abc123", instanceId: "iad-1" },
        deploymentEnvironmentName: "preview",
        attributes: { region: "iad1" },
      },
    }, DRIFT_GUARD_BATCH_ID);

    expect(normalized.productEvents).toHaveLength(0);
    // The SDK owns span identity, so the writer composes NOTHING: no prefixes, no
    // assembled ancestry. Session and page identity land as scalar correlation
    // columns instead of being folded into a parent chain.
    expect(normalized.logOccurrences[0]).toMatchObject({
      trace_id: "22222222222222222222222222222222",
      span_id: "3333333333333333",
      page_view_span_id: "1111111111111111",
      refresh_token_id: "55555555-5555-4555-8555-555555555555",
      session_replay_id: "66666666-6666-4666-8666-666666666666",
      session_replay_segment_id: "77777777-7777-4777-8777-777777777777",
    });
    expect(normalized.logOccurrences[0]).toMatchObject({
      service_namespace: "commerce",
      service_name: "storefront",
      service_version: "abc123",
      service_instance_id: "iad-1",
      deployment_environment_name: "preview",
      resource_attributes: JSON.stringify({ region: "iad1" }),
    });
  });
});
