import { describe, expect, expectTypeOf, test } from "vitest";
import { LOGS_COLUMNS, type ClickhouseColumn, type LogColumnName } from "../../scripts/clickhouse-migrations";
import { buildLogInsertRows, type AnalyticsLogRow } from "./self-telemetry-logs";

// Only the KEY SET of this sample matters — it is compared against
// LOGS_COLUMNS to catch drift between the hand-listed insert row and the
// table declaration (see the equivalent guard in self-telemetry-spans.test.ts).
const SAMPLE_LOG_ROW: AnalyticsLogRow = {
  event_type: "$log",
  event_at: new Date("2026-07-23T00:00:00.123Z"),
  message: "hello",
  level: "info",
  data: {},
  parent_span_ids: [],
  trace_id: null,
  span_id: null,
  producer: "hexclave-backend",
  service_namespace: null,
  service_name: null,
  service_version: null,
  service_instance_id: null,
  deployment_environment_name: null,
  resource_attributes: "{}",
};

describe("analytics log insert rows vs. ClickHouse column declarations", () => {
  test("log rows cover the logs table", () => {
    const [row] = buildLogInsertRows([SAMPLE_LOG_ROW], { projectId: "test-project", branchId: "main" });

    // Widened so `.default` (absent on the narrowed as-const members without
    // one) is accessible as an optional property.
    const logColumns: readonly ClickhouseColumn[] = LOGS_COLUMNS;
    const columnNames = new Set<string>(logColumns.map((column) => column.name));
    for (const key of Object.keys(row)) {
      expect(columnNames.has(key), `insert row writes ${JSON.stringify(key)}, which is not a declared column`).toBe(true);
    }
    for (const column of logColumns) {
      if (column.name in row) continue;
      expect(
        column.default != null,
        `column ${JSON.stringify(column.name)} is not written by the insert row and has no DB-side DEFAULT to fall back to`,
      ).toBe(true);
    }

    // Same guarantee at compile time.
    type LogInsertRow = ReturnType<typeof buildLogInsertRows>[number];
    expectTypeOf<Exclude<keyof LogInsertRow, LogColumnName>>().toEqualTypeOf<never>();
  });
});
