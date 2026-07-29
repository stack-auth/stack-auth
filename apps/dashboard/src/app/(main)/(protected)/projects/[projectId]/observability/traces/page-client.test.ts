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
  SPAN_DETAIL_COLUMNS,
  SPAN_TECHNICAL_DETAIL_COLUMNS,
  TRACE_SERVICES_QUERY,
} from "./page-client";
import {
  selectValueToServiceIdentity,
  serviceIdentityToSelectValue,
} from "../service-identity";

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

  it("lists only physical roots and leaves bridged backend children in the selected waterfall", () => {
    const { query } = getRecentTraceRootsQuery(null);
    expect(query).toContain("FROM default.trace_roots AS r");
    expect(query).toContain("r.span_type != '$http-client'");
    expect(query).toContain("r.status_code");
    expect(query).not.toContain("'bridged-server'");
    expect(query).not.toContain("length(s.parent_span_ids) = 1");
    expect(query).not.toContain("row_number() OVER");
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
    const { query, params } = getRecentTraceRootsQuery(null, {
      namespace: "server",
      name: "stack-backend",
    });
    expect(query).toContain("FROM default.trace_services");
    expect(query).toContain("coalesce(service_namespace, '') = {serviceNamespace:String}");
    expect(query).toContain("service_name = {serviceName:String}");
    expect(query).not.toContain("FROM default.refresh_tokens");
    expect(params).toMatchObject({
      serviceNamespace: "server",
      serviceName: "stack-backend",
    });
  });

  it("searches and paginates trace roots on the server", () => {
    const { query, params } = getRecentTraceRootsQuery(
      { startMs: 1234, id: "older-root" },
      { namespace: "server", name: "stack-backend" },
      "alice@example.com",
    );

    expect(query).toContain("positionCaseInsensitiveUTF8(r.span_type, {search:String})");
    expect(query).toContain("positionCaseInsensitiveUTF8(r.trace_id, {search:String})");
    expect(query).toContain("LEFT JOIN default.users AS u");
    expect(query).toContain("positionCaseInsensitiveUTF8(ifNull(u.primary_email, ''), {search:String})");
    expect(query).toContain("started_at < fromUnixTimestamp64Milli({cursorStartMs:Int64})");
    expect(params).toMatchObject({
      cursorStartMs: 1234,
      cursorId: "older-root",
      serviceNamespace: "server",
      serviceName: "stack-backend",
      search: "alice@example.com",
    });

    const unfiltered = getRecentTraceRootsQuery(null);
    expect(unfiltered.query).not.toContain("{search:String}");
    expect(unfiltered.params).not.toHaveProperty("search");
  });

  it("lists only named physical service identities and round-trips the filter", () => {
    expect(TRACE_SERVICES_QUERY).toContain("SELECT service_namespace, service_name");
    expect(TRACE_SERVICES_QUERY).toContain("service_name != ''");
    expect(TRACE_SERVICES_QUERY).toContain("GROUP BY service_namespace, service_name");
    expect(TRACE_SERVICES_QUERY).not.toContain("Hexclave");

    const identity = { namespace: "browser", name: "stack-dashboard" };
    expect(selectValueToServiceIdentity(serviceIdentityToSelectValue(identity))).toEqual(identity);
  });

  it("loads physical service sets for every root instead of attributing synthetic roots", () => {
    const { query } = getRecentTraceRootsQuery(null);
    // Once trace_services is joined, ClickHouse otherwise serializes this
    // field as "r.trace_id"; the row parser intentionally requires trace_id.
    expect(query).toContain("r.trace_id AS trace_id");
    expect(query).toContain("arraySort(groupUniqArray(tuple(coalesce(service_namespace, ''), service_name)))");
    expect(query).toContain("trace_service_namespaces");
    expect(query).toContain("trace_service_names");
    expect(query).toContain("WHERE service_name != ''");
  });

  it("loads a bridged W3C-id trace by trace ID instead of a truncated recent-span window", () => {
    const spanQuery = getSelectedTraceSpanQuery(
      "0123456789abcdef0123456789abcdef",
    );
    expect(spanQuery).toMatchObject({
      params: { traceId: "0123456789abcdef0123456789abcdef" },
    });
    expect(spanQuery.query).toContain("s.parent_span_ids");
    expect(spanQuery.query).toContain("s.status_code");
    expect(spanQuery.query).not.toContain("s.data");
    expect(spanQuery.query).not.toContain("s.resource_attributes");
    expect(spanQuery.query).toContain("reverse_bridge AS");
    expect(spanQuery.query).toContain("reverse_bridge_ancestors AS");
    expect(spanQuery.query).toContain("s.span_id IN (SELECT span_id FROM reverse_bridge)");
    expect(spanQuery.query).toContain("s.span_id IN (SELECT span_id FROM reverse_bridge_ancestors)");
    expect(spanQuery.query).toContain("ORDER BY s.trace_id = {traceId:String} DESC, s.started_at ASC");
  });

  it("loads only the detail dialog's columns when a span detail opens", () => {
    const detailQuery = getSpanDetailQuery("trace-123", "span-456");
    // A point lookup over the FINAL + UNION ALL spans view must never SELECT *.
    expect(detailQuery.query).not.toContain("*");
    expect(detailQuery.query).toContain(`SELECT ${SPAN_DETAIL_COLUMNS.join(", ")}`);
    expect(detailQuery.query).toContain("trace_id = {traceId:String}");
    expect(detailQuery.query).toContain("span_id = {spanId:String}");
    expect(detailQuery.query).toContain("LIMIT 1");
    expect(detailQuery.params).toEqual({ traceId: "trace-123", spanId: "span-456" });

    // Everything parseSpanRow consumes must stay in the column list.
    for (const column of ["trace_id", "span_id", "span_type", "started_at", "ended_at", "parent_span_ids", "status_code", "data", "resource_attributes"]) {
      expect(SPAN_DETAIL_COLUMNS).toContain(column);
    }
    // Scoping/internal columns stay out of the detail dialog.
    expect(SPAN_DETAIL_COLUMNS).not.toContain("project_id");
    expect(SPAN_DETAIL_COLUMNS).not.toContain("branch_id");
    expect(SPAN_DETAIL_COLUMNS).not.toContain("version");
    // Cut telemetry-protocol columns must never resurface in the dialog.
    for (const column of ["trace_state", "trace_flags", "resource_schema_url", "scope_attributes", "scope_schema_url", "dropped_resource_attributes", "dropped_scope_attributes", "dropped_attributes", "dropped_events", "dropped_links"]) {
      expect(SPAN_DETAIL_COLUMNS).not.toContain(column);
    }
    expect(SPAN_DETAIL_COLUMNS).toMatchInlineSnapshot(`
      [
        "span_type",
        "started_at",
        "ended_at",
        "status_code",
        "status_message",
        "deployment_environment_name",
        "data",
        "user_id",
        "team_id",
        "refresh_token_id",
        "session_replay_id",
        "session_replay_segment_id",
        "trace_id",
        "span_id",
        "parent_span_ids",
        "kind",
        "scope_name",
        "scope_version",
        "service_namespace",
        "service_name",
        "service_version",
        "service_instance_id",
        "resource_attributes",
        "producer",
        "created_at",
      ]
    `);
  });

  it("collapses raw identifiers behind the technical-details disclosure", () => {
    // Every technical column that the detail query selects must actually be
    // selected (otherwise the disclosure section can never show it), and no
    // native product field may be hidden away as technical.
    const queriedTechnicalColumns = SPAN_TECHNICAL_DETAIL_COLUMNS.filter((column) => SPAN_DETAIL_COLUMNS.includes(column));
    expect(queriedTechnicalColumns).toEqual([
      "trace_id",
      "span_id",
      "parent_span_ids",
      "kind",
      "scope_name",
      "scope_version",
      "service_namespace",
      "service_name",
      "service_version",
      "service_instance_id",
      "resource_attributes",
      "producer",
      "created_at",
    ]);
    for (const nativeColumn of ["span_type", "started_at", "ended_at", "status_code", "status_message", "data", "user_id", "deployment_environment_name"]) {
      expect(SPAN_TECHNICAL_DETAIL_COLUMNS).not.toContain(nativeColumn);
    }
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
      span_type: "$refresh-token",
      started_at: "2026-07-21 12:00:00.000",
      ended_at: null,
      parent_span_ids: [],
      data: "{}",
    };
    expect(parseUniqueSpanRows([row, row])).toHaveLength(1);
  });
});
