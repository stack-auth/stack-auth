import { describe, expect, expectTypeOf, test } from "vitest";
import {
  SPAN_EVENTS_COLUMNS,
  SPANS_COLUMNS,
  SPAN_LINKS_COLUMNS,
  type ClickhouseColumn,
  type SpanEventColumnName,
  type SpanColumnName,
  type SpanLinkColumnName,
} from "../../scripts/clickhouse-migrations";
import { buildSpanEventInsertRows, buildSpanInsertRows, buildSpanLinkInsertRows, type AnalyticsSpanRow } from "./self-telemetry-spans";

// A fully-populated span so every optional-ish field shows up in the built
// rows' key sets. The VALUES are irrelevant to these tests — only the keys are.
const SAMPLE_SPAN_ROW: AnalyticsSpanRow = {
  trace_id: "5b8efff798038103d269b633813fc60c",
  span_id: "eee19b7ec3c1b174",
  span_type: "checkout",
  started_at: new Date("2026-07-23T00:00:00.123Z"),
  ended_at: new Date("2026-07-23T00:00:00.456Z"),
  parent_span_ids: [],
  kind: "internal",
  status_code: "ok",
  status_message: null,
  service_namespace: null,
  service_name: "checkout-api",
  service_version: null,
  service_instance_id: null,
  deployment_environment_name: null,
  resource_attributes: "{}",
  scope_name: null,
  scope_version: null,
  data: "{}",
  producer: "hexclave-backend",
  events: [{
    name: "query.complete",
    at: new Date("2026-07-23T00:00:00.400Z"),
    data: {},
  }],
  links: [{
    linked_trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
    linked_span_id: "00f067aa0ba902b7",
    attributes: "{}",
  }],
  version: 1753228800456,
};

const SAMPLE_INGEST_CONTEXT = {
  projectId: "test-project",
  branchId: "main",
};

/**
 * The drift guard tying the hand-listed insert-row keys in self-telemetry-spans.ts
 * to the single source of truth for the table shapes in
 * scripts/clickhouse-migrations.ts. Without it, a column added to one side but
 * not the other only fails at INSERT time in production (ClickHouse rejects
 * unknown keys in JSONEachRow), which is exactly the failure mode the column
 * declarations exist to prevent.
 *
 * Two directions:
 *  - every row key must be a declared column, and
 *  - every declared column the row does NOT write must have a DB-side DEFAULT
 *    (e.g. `created_at DEFAULT now64(3)` — deliberately ingestion-time).
 */
function expectRowToMatchColumns(row: Record<string, unknown>, columns: readonly ClickhouseColumn[]) {
  const columnNames = new Set<string>(columns.map((column) => column.name));
  for (const key of Object.keys(row)) {
    expect(columnNames.has(key), `insert row writes ${JSON.stringify(key)}, which is not a declared column`).toBe(true);
  }
  for (const column of columns) {
    if (column.name in row) continue;
    expect(
      column.default != null,
      `column ${JSON.stringify(column.name)} is not written by the insert row and has no DB-side DEFAULT to fall back to`,
    ).toBe(true);
  }
}

describe("analytics span insert rows vs. ClickHouse column declarations", () => {
  test("span rows cover the spans table", () => {
    const [row] = buildSpanInsertRows([SAMPLE_SPAN_ROW], SAMPLE_INGEST_CONTEXT);
    expectRowToMatchColumns(row, SPANS_COLUMNS);

    // Same guarantee at compile time (the row builder's return type may not
    // contain a key outside the declared column-name union).
    type SpanInsertRow = ReturnType<typeof buildSpanInsertRows>[number];
    expectTypeOf<Exclude<keyof SpanInsertRow, SpanColumnName>>().toEqualTypeOf<never>();
  });

  test("span event rows cover the span-events table", () => {
    const [row] = buildSpanEventInsertRows([SAMPLE_SPAN_ROW], SAMPLE_INGEST_CONTEXT);
    expectRowToMatchColumns(row, SPAN_EVENTS_COLUMNS);

    type SpanEventInsertRow = ReturnType<typeof buildSpanEventInsertRows>[number];
    expectTypeOf<Exclude<keyof SpanEventInsertRow, SpanEventColumnName>>().toEqualTypeOf<never>();
  });

  test("span event rows inherit their span's producer and ancestry", () => {
    const [row] = buildSpanEventInsertRows([SAMPLE_SPAN_ROW], SAMPLE_INGEST_CONTEXT);
    expect(row.producer).toBe("hexclave-backend");
    expect(row.parent_span_ids).toEqual(["eee19b7ec3c1b174"]);
    expect(row.trace_id).toBe(SAMPLE_SPAN_ROW.trace_id);
    expect(row.span_id).toBe(SAMPLE_SPAN_ROW.span_id);
  });

  test("span link rows cover the span_links table", () => {
    const [row] = buildSpanLinkInsertRows([SAMPLE_SPAN_ROW], SAMPLE_INGEST_CONTEXT);
    expectRowToMatchColumns(row, SPAN_LINKS_COLUMNS);

    type SpanLinkInsertRow = ReturnType<typeof buildSpanLinkInsertRows>[number];
    expectTypeOf<Exclude<keyof SpanLinkInsertRow, SpanLinkColumnName>>().toEqualTypeOf<never>();
  });
});
