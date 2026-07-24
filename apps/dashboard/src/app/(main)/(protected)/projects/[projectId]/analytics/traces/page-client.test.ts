import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  getRecentTraceRootsQuery,
  getSelectedTraceEventQuery,
  getSelectedTraceSpanQuery,
  getSpanDetailQuery,
  parseEventRow,
  parseUniqueSpanRows,
  selectValueToServiceName,
  serviceNameToLabel,
  serviceNameToSelectValue,
} from "./page-client";

describe("analytics trace row parsing", () => {
  it("uses one compact spacing token without changing the sticky threshold", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const pageSource = readFileSync(join(testDir, "page-client.tsx"), "utf-8");
    const pageLayoutSource = readFileSync(join(testDir, "../../page-layout.tsx"), "utf-8");
    const stickyHeaderSource = readFileSync(join(testDir, "../../sticky-page-header.tsx"), "utf-8");

    expect(pageSource).toContain('<PageLayout fillWidth scrollMain spacing="compact">');
    expect(pageSource).toContain("gap-[var(--page-content-gap)]");
    expect(pageLayoutSource).toContain("[--page-content-gap:0.75rem]");
    expect(stickyHeaderSource).toContain("STICKY_HEADER_COMPACT_SCROLL_TOP - sentinelStartOffset");
    expect(stickyHeaderSource).not.toContain("-mb-[17px]");
  });

  it("bounds the virtualized trace rail to the page scroller without letting hidden cached routes override it", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const pageSource = readFileSync(join(testDir, "page-client.tsx"), "utf-8");
    const shellSource = readFileSync(join(testDir, "../../sidebar-layout.tsx"), "utf-8");

    expect(pageSource).toContain('<PageLayout fillWidth scrollMain spacing="compact">');
    expect(pageSource).toContain("grid min-w-0 flex-1 gap-[var(--page-content-gap)]");
    expect(pageSource).toContain("lg:max-h-[calc(100cqh-0.75rem)]");
    expect(pageSource).toContain("lg:[contain:size]");
    expect(pageSource).toContain("min-w-0 self-start");
    expect(pageSource).not.toContain("--trace-list-height-offset");
    expect(pageSource).not.toContain("lg:h-[calc(100dvh");
    expect(shellSource).toContain("has-[[data-scroll-main]:not([style*='display:_none'])]:[container-type:size]");
    expect(shellSource).toContain("has-[[data-contained-height]:not([style*='display:_none'])]:overflow-hidden");
    expect(shellSource).not.toContain("has-[[data-scroll-main]]:[container-type:size]");
    expect(shellSource).not.toContain("has-[[data-contained-height]]:overflow-hidden");
  });

  it("does not reload the selected waterfall when root pagination extends the sidebar", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const pageSource = readFileSync(join(testDir, "page-client.tsx"), "utf-8");

    expect(pageSource).toContain("const loadSelectedTrace = useCallback(async (traceId: string)");
    expect(pageSource).toContain("loadSelectedTrace(selectedRootTraceId)");
    expect(pageSource).toContain("}, [adminApp, hours]);");
    expect(pageSource).not.toContain("}, [adminApp, hours, rootSpans, serviceName]);");
  });

  it("normalizes serialized event data for the shared detail dialog", () => {
    expect(parseEventRow({
      event_type: "checkout",
      event_at: "2026-07-21 12:00:00.000",
      parent_span_ids: ["rti-session", 42],
      data: "{\"step\":2}",
    })).toMatchObject({
      eventType: "checkout",
      parentSpanIds: ["rti-session"],
      raw: { data: { step: 2 } },
    });
  });

  it("loads only real parent spans into the trace list", () => {
    const { query } = getRecentTraceRootsQuery(null);
    expect(query).toContain("FROM default.trace_roots AS r");
    expect(query).toContain("r.status_code");
    expect(query).not.toContain("FROM default.spans");
    expect(query).not.toContain("UNION ALL");
    expect(query).not.toContain("FROM default.refresh_tokens");
    expect(query).toContain("LEFT JOIN default.users AS u");
  });

  it("loads root user profiles in the root query instead of a second request", () => {
    const { query } = getRecentTraceRootsQuery(null);
    expect(query).toContain("u.display_name AS user_display_name");
    expect(query).toContain("u.primary_email AS user_primary_email");
    expect(query).toContain("u.profile_image_url AS user_profile_image_url");
  });

  it("uses a stable time-and-id cursor for older parent trace pages", () => {
    const { query, params } = getRecentTraceRootsQuery({ startMs: 1234, id: "otel-root" });
    expect(query).toContain("started_at < fromUnixTimestamp64Milli({cursorStartMs:Int64})");
    expect(query).toContain("span_id < {cursorId:String}");
    expect(query).not.toContain("FROM default.refresh_tokens");
    expect(params).toMatchObject({ cursorStartMs: 1234, cursorId: "otel-root" });
  });

  it("filters by every service participating in a trace, not only the root service", () => {
    const { query, params } = getRecentTraceRootsQuery(null, "stack-backend");
    expect(query).toContain("FROM default.trace_services");
    expect(query).toContain("service_name = {serviceName:String}");
    expect(query).not.toContain("FROM default.refresh_tokens");
    expect(params).toMatchObject({ serviceName: "stack-backend" });
  });

  it("searches and paginates trace roots on the server", () => {
    const { query, params } = getRecentTraceRootsQuery(
      { startMs: 1234, id: "older-root" },
      "stack-backend",
      "alice@example.com",
    );

    expect(query).toContain("positionCaseInsensitiveUTF8(r.name, {search:String})");
    expect(query).toContain("positionCaseInsensitiveUTF8(r.trace_id, {search:String})");
    expect(query).toContain("LEFT JOIN default.users AS u");
    expect(query).toContain("positionCaseInsensitiveUTF8(ifNull(u.primary_email, ''), {search:String})");
    expect(query).toContain("started_at < fromUnixTimestamp64Milli({cursorStartMs:Int64})");
    expect(params).toMatchObject({
      cursorStartMs: 1234,
      cursorId: "older-root",
      serviceName: "stack-backend",
      search: "alice@example.com",
    });

    const unfiltered = getRecentTraceRootsQuery(null);
    expect(unfiltered.query).not.toContain("{search:String}");
    expect(unfiltered.params).not.toHaveProperty("search");
  });

  it("presents legacy unnamed spans as the native Hexclave service and round-trips the filter", () => {
    expect(serviceNameToSelectValue(null)).toBe("all");
    expect(serviceNameToSelectValue("")).toBe("service:");
    expect(serviceNameToLabel("")).toBe("Hexclave");
    expect(serviceNameToLabel("stack-backend")).toBe("stack-backend");
    expect(selectValueToServiceName("all")).toBeNull();
    expect(selectValueToServiceName("service:")).toBe("");
    expect(selectValueToServiceName("service:stack-backend")).toBe("stack-backend");
    expect(() => selectValueToServiceName("unexpected")).toThrow(
      "Unexpected trace service select value: unexpected",
    );
  });

  it("loads an OpenTelemetry trace by trace ID instead of a truncated recent-span window", () => {
    const spanQuery = getSelectedTraceSpanQuery(
      "0123456789abcdef0123456789abcdef",
    );
    expect(spanQuery).toMatchObject({
      params: { traceId: "0123456789abcdef0123456789abcdef" },
    });
    expect(spanQuery.query).toContain("s.parent_span_ids");
    expect(spanQuery.query).toContain("s.status_code");
    expect(spanQuery.query).not.toContain("s.attributes");
    expect(spanQuery.query).not.toContain("s.resource_attributes");
    expect(spanQuery.query).not.toContain("s.scope_attributes");
  });

  it("loads a complete span row only when its detail dialog opens", () => {
    const detailQuery = getSpanDetailQuery("trace-123", "span-456");
    expect(detailQuery.query).toContain("SELECT *");
    expect(detailQuery.query).toContain("trace_id = {traceId:String}");
    expect(detailQuery.query).toContain("span_id = {spanId:String}");
    expect(detailQuery.query).toContain("LIMIT 1");
    expect(detailQuery.params).toEqual({ traceId: "trace-123", spanId: "span-456" });
  });

  it("loads the complete distributed trace after filtering the inbox by service", () => {
    const spans = getSelectedTraceSpanQuery("0123456789abcdef0123456789abcdef");
    const events = getSelectedTraceEventQuery("0123456789abcdef0123456789abcdef", 24);

    expect(spans.query).not.toContain("{serviceName:String}");
    expect(events.query).not.toContain("{serviceName:String}");
    expect(spans.params).toEqual({
      traceId: "0123456789abcdef0123456789abcdef",
    });
    expect(events.params).toEqual({
      traceId: "0123456789abcdef0123456789abcdef",
      hours: 24,
    });
  });

  it("loads a native trace from its selected parent", () => {
    expect(getSelectedTraceSpanQuery("cs-native-span")).toMatchObject({
      params: { traceId: "cs-native-span" },
    });
  });

  it("deduplicates a refresh-token parent returned by both span queries", () => {
    const row = {
      trace_id: "rti-old",
      span_id: "rti-old",
      name: "$refresh-token",
      started_at: "2026-07-21 12:00:00.000",
      ended_at: null,
      parent_span_ids: [],
      attributes: "{}",
    };
    expect(parseUniqueSpanRows([row, row])).toHaveLength(1);
  });
});
