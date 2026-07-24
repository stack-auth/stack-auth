import { ITEM_IDS, PLAN_LIMITS } from "@hexclave/shared/dist/plans";
import { wait } from "@hexclave/shared/dist/utils/promises";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { randomBytes } from "node:crypto";
import { it } from "../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../backend-helpers";
import { getItemQuantity, setItemQuantity, waitForItemQuantityToReach } from "../../../payment-quota-helpers";

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function createSingleSpanPayload(options: { traceId?: string } = {}) {
  const startNanos = BigInt(Date.now()) * 1_000_000n;
  return {
    resourceSpans: [{
      scopeSpans: [{
        spans: [{
          traceId: options.traceId ?? randomHex(16),
          spanId: randomHex(8),
          name: "checkout",
          startTimeUnixNano: String(startNanos),
          endTimeUnixNano: String(startNanos + 1_000_000n),
        }],
      }],
    }],
  };
}

async function exportOtlpPayload(payload: unknown) {
  return await niceBackendFetch("/api/v1/analytics/otlp/v1/traces", {
    method: "POST",
    accessType: "server",
    rawBody: new TextEncoder().encode(JSON.stringify(payload)),
    rawContentType: "application/json",
  });
}

async function setupOtlpProject(options: { analyticsEnabled: boolean }): Promise<{ ownerTeamId: string }> {
  const { createProjectResponse } = await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  if (options.analyticsEnabled) {
    await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  }
  const ownerTeamId = createProjectResponse.body.owner_team_id;
  if (typeof ownerTeamId !== "string") throw new Error("Expected the OTLP test project to have an owner team");
  return { ownerTeamId };
}

function getResultRows(body: unknown): unknown[] {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("result" in body)) {
    throw new Error("Expected analytics query response body with a result field");
  }
  if (!Array.isArray(body.result)) throw new Error("Expected analytics query result to be an array");
  return body.result;
}

it("maps OTLP/HTTP JSON spans into the native Analytics span shape", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });

  const traceId = randomHex(16);
  const rootSpanId = randomHex(8);
  const childSpanId = randomHex(8);
  const startNanos = BigInt(Date.now()) * 1_000_000n;
  const payload = {
    resourceSpans: [{
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "checkout-api" } },
          { key: "deployment.environment.name", value: { stringValue: "e2e" } },
        ],
      },
      scopeSpans: [{
        scope: { name: "@prisma/instrumentation", version: "7.1.0" },
        spans: [
          {
            traceId,
            spanId: rootSpanId,
            name: "POST /checkout",
            kind: 2,
            startTimeUnixNano: String(startNanos),
            endTimeUnixNano: String(startNanos + 20_000_000n),
            attributes: [{ key: "http.request.method", value: { stringValue: "POST" } }],
            status: { code: 1 },
          },
          {
            traceId,
            spanId: childSpanId,
            parentSpanId: rootSpanId,
            name: "prisma:client:operation",
            kind: 1,
            startTimeUnixNano: String(startNanos + 2_000_000n),
            endTimeUnixNano: String(startNanos + 15_000_000n),
            attributes: [{ key: "db.operation.name", value: { stringValue: "create" } }],
            events: [{
              timeUnixNano: String(startNanos + 10_000_000n),
              name: "query.complete",
              attributes: [{ key: "cache.hit", value: { boolValue: false } }],
            }],
            links: [{
              traceId: randomHex(16),
              spanId: randomHex(8),
              flags: 1,
            }],
            status: { code: 1 },
          },
        ],
      }],
    }],
  };

  const exportResponse = await niceBackendFetch("/api/v1/analytics/otlp/v1/traces", {
    method: "POST",
    accessType: "server",
    rawBody: new TextEncoder().encode(JSON.stringify(payload)),
    rawContentType: "application/json",
  });

  expect(exportResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {},
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  let rows: unknown[] = [];
  for (let attempt = 0; attempt < 20 && rows.length !== 2; attempt += 1) {
    await wait(250);
    const queryResponse = await niceBackendFetch("/api/v1/analytics/query", {
      method: "POST",
      accessType: "admin",
      body: {
        query: "SELECT span_id, parent_span_ids, name, service_name, scope_name, kind, status_code FROM spans WHERE trace_id = {traceId:String} ORDER BY span_id",
        params: { traceId },
      },
    });
    if (queryResponse.status !== 200) {
      throw new Error(`Expected analytics query to succeed: ${JSON.stringify(queryResponse.body)}`);
    }
    rows = getResultRows(queryResponse.body);
  }

  const expectedRows = [
    {
      span_id: rootSpanId,
      parent_span_ids: [],
      name: "POST /checkout",
      service_name: "checkout-api",
      scope_name: "@prisma/instrumentation",
      kind: "server",
      status_code: "ok",
    },
    {
      span_id: childSpanId,
      parent_span_ids: [rootSpanId],
      name: "prisma:client:operation",
      service_name: "checkout-api",
      scope_name: "@prisma/instrumentation",
      kind: "internal",
      status_code: "ok",
    },
  ].sort((a, b) => stringCompare(a.span_id, b.span_id));
  expect(rows).toEqual(expectedRows);

  const relatedRowsResponse = await niceBackendFetch("/api/v1/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: `
        SELECT 'event' AS row_type, event_type AS name, parent_span_ids
        FROM events
        WHERE trace_id = {traceId:String}
        UNION ALL
        SELECT 'link' AS row_type, linked_span_id AS name, [owner_span_id] AS parent_span_ids
        FROM span_links
        WHERE trace_id = {traceId:String}
        ORDER BY row_type`,
      params: { traceId },
    },
  });
  expect(relatedRowsResponse.status).toBe(200);
  const relatedRows = getResultRows(relatedRowsResponse.body);
  expect(relatedRows).toHaveLength(2);
  expect(relatedRows).toEqual(expect.arrayContaining([
    expect.objectContaining({
      row_type: "link",
      parent_span_ids: [childSpanId],
    }),
    expect.objectContaining({
      row_type: "event",
      name: "query.complete",
      parent_span_ids: [
        rootSpanId,
        childSpanId,
      ],
    }),
  ]));

  const serviceIndexResponse = await niceBackendFetch("/api/v1/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "SELECT trace_id, service_name FROM trace_services WHERE trace_id = {traceId:String}",
      params: { traceId },
    },
  });
  expect(serviceIndexResponse.status).toBe(200);
  expect(getResultRows(serviceIndexResponse.body)).toEqual([{ trace_id: traceId, service_name: "checkout-api" }]);
});

it("accepts authenticated browser OTLP ingestion with client credentials", { timeout: 120_000 }, async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Anonymous.signUp();

  const response = await niceBackendFetch("/api/v1/analytics/otlp/v1/traces", {
    method: "POST",
    accessType: "client",
    rawBody: new TextEncoder().encode(JSON.stringify({ resourceSpans: [] })),
    rawContentType: "application/json",
  });

  expect(response.status).toBe(200);
});

it("rejects malformed OTLP spans with a useful validation error", async ({ expect }) => {
  await setupOtlpProject({ analyticsEnabled: true });

  const response = await exportOtlpPayload(createSingleSpanPayload({ traceId: "not-a-trace-id" }));

  expect(response.status).toBe(400);
  expect(response.body).toBe("request.resourceSpans[0].scopeSpans[0].spans[0].traceId must be a non-zero 32-character hexadecimal identifier");
});

it("rejects OTLP ingestion when Analytics is disabled", async ({ expect }) => {
  await setupOtlpProject({ analyticsEnabled: false });

  const response = await exportOtlpPayload(createSingleSpanPayload());

  expect(response.status).toBe(400);
  expect(response.body.code).toBe("ANALYTICS_NOT_ENABLED");
});

it("debits the Analytics spans quota for accepted OTLP spans", { timeout: 120_000 }, async ({ expect }) => {
  const { ownerTeamId } = await setupOtlpProject({ analyticsEnabled: true });
  await waitForItemQuantityToReach(ownerTeamId, ITEM_IDS.analyticsSpans, PLAN_LIMITS.free.analyticsSpans);
  const quantityBefore = await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsSpans);

  const response = await exportOtlpPayload(createSingleSpanPayload());

  expect(response.status).toBe(200);
  expect(await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsSpans)).toBe(quantityBefore - 1);
});

it("rejects OTLP ingestion without debiting when the Analytics spans quota is exhausted", { timeout: 120_000 }, async ({ expect }) => {
  const { ownerTeamId } = await setupOtlpProject({ analyticsEnabled: true });
  await waitForItemQuantityToReach(ownerTeamId, ITEM_IDS.analyticsSpans, PLAN_LIMITS.free.analyticsSpans);
  await setItemQuantity(ownerTeamId, ITEM_IDS.analyticsSpans, 0);

  const response = await exportOtlpPayload(createSingleSpanPayload());

  expect(response.status).toBe(400);
  expect(response.body.code).toBe("ITEM_QUANTITY_INSUFFICIENT_AMOUNT");
  expect(await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsSpans)).toBe(0);
});
