import { ITEM_IDS, PLAN_LIMITS, type PlanId } from "@hexclave/shared/dist/plans";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { wait } from "@hexclave/shared/dist/utils/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { it } from "../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch, withInternalProject } from "../../../backend-helpers";
import {
    getItemQuantity,
    setItemQuantity,
    waitForItemQuantityToReach,
    waitForItemQuantityToStabilize,
} from "../../../payment-quota-helpers";

async function uploadEventBatch(options: {
  sessionReplaySegmentId: string,
  batchId: string,
  sentAtMs: number,
  events: { event_type: string, event_at_ms: number, data: unknown }[],
}) {
  return await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_replay_segment_id: options.sessionReplaySegmentId,
      batch_id: options.batchId,
      sent_at_ms: options.sentAtMs,
      events: options.events,
    },
  });
}

it("requires a user token", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  backendContext.set({ userAuth: null });

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_replay_segment_id: randomUUID(),
      batch_id: randomUUID(),
      sent_at_ms: Date.now(),
      events: [{ event_type: "$page-view", event_at_ms: Date.now(), data: {} }],
    },
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "USER_AUTHENTICATION_REQUIRED",
        "error": "User authentication required for this endpoint.",
      },
      "headers": Headers {
        "x-stack-known-error": "USER_AUTHENTICATION_REQUIRED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("throws error when analytics is not enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  // Analytics is disabled by default - do NOT call Project.updateConfig
  await Auth.Otp.signIn();

  const res = await uploadEventBatch({
    sessionReplaySegmentId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: Date.now(),
    events: [{ event_type: "$page-view", event_at_ms: Date.now(), data: {} }],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("ANALYTICS_NOT_ENABLED");
});

it("accepts valid $page-view events", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const now = Date.now();
  const res = await uploadEventBatch({
    sessionReplaySegmentId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: now,
    events: [
      {
        event_type: "$page-view",
        event_at_ms: now - 100,
        data: {
          url: "https://example.com/page",
          path: "/page",
          referrer: "",
          title: "Test Page",
          entry_type: "initial",
          viewport_width: 1920,
          viewport_height: 1080,
          screen_width: 1920,
          screen_height: 1080,
        },
      },
      {
        event_type: "$page-view",
        event_at_ms: now - 50,
        data: {
          url: "https://example.com/other",
          path: "/other",
          referrer: "https://example.com/page",
          title: "Other Page",
          entry_type: "push",
          viewport_width: 1920,
          viewport_height: 1080,
          screen_width: 1920,
          screen_height: 1080,
        },
      },
    ],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "inserted": 2, "accepted_spans": 0 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("accepts valid $click events", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const now = Date.now();
  const res = await uploadEventBatch({
    sessionReplaySegmentId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: now,
    events: [
      {
        event_type: "$click",
        event_at_ms: now - 50,
        data: {
          tag_name: "button",
          text: "Submit",
          href: null,
          selector: "div > form > button.submit-btn",
          x: 100,
          y: 200,
          page_x: 100,
          page_y: 500,
          viewport_width: 1920,
          viewport_height: 1080,
        },
      },
    ],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "inserted": 1, "accepted_spans": 0 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("accepts a gzipped binary body (adblocker-evasion encoding)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const now = Date.now();
  const payload = {
    session_replay_segment_id: randomUUID(),
    batch_id: randomUUID(),
    sent_at_ms: now,
    events: [
      {
        event_type: "$click",
        event_at_ms: now - 50,
        data: {
          tag_name: "button",
          text: "Encoded",
          href: null,
          selector: "button.encoded",
          x: 1, y: 2, page_x: 1, page_y: 2,
          viewport_width: 100, viewport_height: 100,
        },
      },
    ],
  };
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf-8"));

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    rawBody: compressed,
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "inserted": 1, "accepted_spans": 0 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("rejects a binary body that isn't valid gzip", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    rawBody: new Uint8Array([0, 1, 2, 3, 4, 5]),
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Invalid encoded analytics body",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("rejects a binary body larger than the compressed size cap", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  // Random bytes don't compress, so even before gunzip the byteLength check
  // fires. 1.1 MB > the 1 MB MAX_COMPRESSED_BYTES cap.
  const oversized = new Uint8Array(randomBytes(Math.floor(1.1 * 1024 * 1024)));

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    rawBody: oversized,
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Encoded analytics body too large",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("rejects a gzipped body that decompresses past the server size cap", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  // 9 MB of zeros gzips to ~9 KB but decompresses past the 8 MB server cap.
  const bomb = gzipSync(Buffer.alloc(9 * 1024 * 1024));

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    rawBody: bomb,
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Invalid encoded analytics body",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("handles click event data containing a truncated surrogate pair (lone high surrogate)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  // Simulate what the client-side event tracker does: .substring(0, 200) can
  // cut a string in the middle of a surrogate pair when emoji characters are
  // near the boundary. For example, 🍉 is "\uD83C\uDF49" in UTF-16; cutting
  // after the high surrogate leaves a lone "\uD83C" that ClickHouse cannot parse.
  const paddedText = "a".repeat(199) + "\uD83C"; // lone high surrogate at position 199

  const now = Date.now();
  const res = await uploadEventBatch({
    sessionReplaySegmentId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: now,
    events: [
      {
        event_type: "$click",
        event_at_ms: now - 50,
        data: {
          tag_name: "div",
          text: paddedText,
          href: null,
          selector: "div.container",
          x: 100,
          y: 200,
          page_x: 100,
          page_y: 500,
          viewport_width: 375,
          viewport_height: 647,
        },
      },
    ],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "inserted": 1, "accepted_spans": 0 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("rejects empty events array", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await uploadEventBatch({
    sessionReplaySegmentId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: Date.now(),
    events: [],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/analytics/events/batch:
              - A batch must contain at least one event or span
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/analytics/events/batch:
            - A batch must contain at least one event or span
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects too many events (>500)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const tooManyEvents = Array.from({ length: 501 }, (_, i) => ({
    event_type: "$page-view",
    event_at_ms: 1_700_000_000_000 + i,
    data: { url: `https://example.com/page-${i}`, path: `/page-${i}` },
  }));

  const res = await uploadEventBatch({
    sessionReplaySegmentId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: 1_700_000_000_100,
    events: tooManyEvents,
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/analytics/events/batch:
              - body.events field must have less than or equal to 500 items
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/analytics/events/batch:
            - body.events field must have less than or equal to 500 items
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects invalid session_replay_segment_id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_replay_segment_id: "not-a-uuid",
      batch_id: randomUUID(),
      sent_at_ms: Date.now(),
      events: [{ event_type: "$page-view", event_at_ms: Date.now(), data: {} }],
    },
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/analytics/events/batch:
              - Invalid session_replay_segment_id
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/analytics/events/batch:
            - Invalid session_replay_segment_id
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects invalid batch_id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_replay_segment_id: randomUUID(),
      batch_id: "not-a-uuid",
      sent_at_ms: Date.now(),
      events: [{ event_type: "$page-view", event_at_ms: Date.now(), data: {} }],
    },
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/analytics/events/batch:
              - Invalid batch_id
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/analytics/events/batch:
            - Invalid batch_id
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects invalid event_type", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_replay_segment_id: randomUUID(),
      batch_id: randomUUID(),
      sent_at_ms: Date.now(),
      events: [{ event_type: "$invalid-type", event_at_ms: Date.now(), data: {} }],
    },
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/analytics/events/batch:
              - event_type must be one of $page-view, $click, $form-submit, $window-resize, $copy, $cut, $paste, $context-menu, $print, $fullscreen-exit or a custom name matching /^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/analytics/events/batch:
            - event_type must be one of $page-view, $click, $form-submit, $window-resize, $copy, $cut, $paste, $context-menu, $print, $fullscreen-exit or a custom name matching /^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("inserted events are queryable via analytics query endpoint", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const now = Date.now();

  const uploadRes = await uploadEventBatch({
    sessionReplaySegmentId,
    batchId: randomUUID(),
    sentAtMs: now,
    events: [
      {
        event_type: "$page-view",
        event_at_ms: now - 200,
        data: { url: "https://example.com/test-query", path: "/test-query" },
      },
      {
        event_type: "$click",
        event_at_ms: now - 100,
        data: { tag_name: "a", text: "Link", selector: "a.link" },
      },
    ],
  });
  expect(uploadRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "inserted": 2, "accepted_spans": 0 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Retry query because async inserts may have a flush delay
  let queryRes;
  for (let attempt = 0; attempt < 15; attempt++) {
    await wait(500);
    queryRes = await niceBackendFetch("/api/v1/analytics/query", {
      method: "POST",
      accessType: "server",
      body: {
        query: "SELECT event_type, session_replay_segment_id FROM events WHERE session_replay_segment_id = {segId:String} ORDER BY event_at",
        params: { segId: sessionReplaySegmentId },
      },
    });
    if (queryRes.status === 200 && queryRes.body?.result?.length === 2) {
      break;
    }
  }

  expect(queryRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "query_id": "<stripped UUID>:main:<stripped UUID>",
        "result": [
          {
            "event_type": "$page-view",
            "session_replay_segment_id": "<stripped UUID>",
          },
          {
            "event_type": "$click",
            "session_replay_segment_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("sets parent_span_ids on inserted events", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const now = Date.now();

  await uploadEventBatch({
    sessionReplaySegmentId,
    batchId: randomUUID(),
    sentAtMs: now,
    events: [
      {
        event_type: "$page-view",
        event_at_ms: now - 100,
        data: { url: "https://example.com/spans", path: "/spans" },
      },
    ],
  });

  let queryRes;
  for (let attempt = 0; attempt < 15; attempt++) {
    await wait(500);
    queryRes = await niceBackendFetch("/api/v1/internal/analytics/query", {
      method: "POST",
      accessType: "admin",
      body: {
        query: "SELECT parent_span_ids, session_replay_id FROM events WHERE session_replay_segment_id = {segId:String}",
        params: { segId: sessionReplaySegmentId },
      },
    });
    if (queryRes.status === 200 && queryRes.body?.result?.length === 1) {
      break;
    }
  }

  expect(queryRes?.status).toBe(200);
  const row = (queryRes?.body as any).result[0];
  // No active session replay for this user, so the only ancestor span is the
  // refresh-token span. The per-tab id itself lives in session_replay_segment_id.
  expect(row.session_replay_id).toBeNull();
  expect(row.parent_span_ids).toHaveLength(1);
  expect(row.parent_span_ids[0]).toMatch(/^rti-/);
});

// ============================================================================
// Analytics event limit enforcement tests
// ============================================================================

async function setupProjectWithPlan(planId: PlanId) {
  const { createProjectResponse } = await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  const ownerTeamId = createProjectResponse.body.owner_team_id;

  if (planId !== "free") {
    await withInternalProject(async () => {
      const grantResponse = await niceBackendFetch(`/api/v1/payments/products/team/${ownerTeamId}`, {
        method: "POST",
        accessType: "server",
        body: { product_id: planId },
      });
      if (grantResponse.status !== 200) {
        throw new HexclaveAssertionError(`Failed to grant plan '${planId}' to team '${ownerTeamId}'`, { response: grantResponse });
      }
    });
  }
  await waitForItemQuantityToReach(ownerTeamId, ITEM_IDS.analyticsEvents, PLAN_LIMITS[planId].analyticsEvents);
  return { ownerTeamId };
}

it("rejects batch when analytics event quota is exhausted", async ({ expect }) => {
  const { ownerTeamId } = await setupProjectWithPlan("free");
  await Auth.Otp.signIn();

  await setItemQuantity(ownerTeamId, ITEM_IDS.analyticsEvents, 0);

  const res = await uploadEventBatch({
    sessionReplaySegmentId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: Date.now(),
    events: [{ event_type: "$page-view", event_at_ms: Date.now(), data: {} }],
  });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe("ITEM_QUANTITY_INSUFFICIENT_AMOUNT");
});

it("accepts batch and debits event quota correctly", { timeout: 120_000 }, async ({ expect }) => {
  const { ownerTeamId } = await setupProjectWithPlan("free");
  await Auth.Otp.signIn();

  // Drain async logEvent debits (sign-in triggers token-refresh/sign-up-rule
  // events asynchronously) before measuring baseline. The
  // `minimumElapsedMs` guards against the failure mode where stability is
  // declared before the async events have had a chance to fire — without
  // it the test reads e.g. 100000, declares it stable, then ~5s later the
  // async events land and the post-batch read is short by 2.
  const quantityBeforeBatch = await waitForItemQuantityToStabilize(
    ownerTeamId,
    ITEM_IDS.analyticsEvents,
    { minimumElapsedMs: 5000 },
  );

  const now = Date.now();
  const eventCount = 3;
  const res = await uploadEventBatch({
    sessionReplaySegmentId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: now,
    events: Array.from({ length: eventCount }, (_, i) => ({
      event_type: "$page-view" as const,
      event_at_ms: now - i,
      data: { url: `https://example.com/page-${i}`, path: `/page-${i}` },
    })),
  });

  expect(res.status).toBe(200);
  expect(res.body.inserted).toBe(eventCount);
  expect(res.body.accepted_spans).toBe(0);

  const afterQuantity = await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsEvents);
  expect(afterQuantity).toBe(quantityBeforeBatch - eventCount);
});

// We don't support metered pricing or partial batches for now, so the entire
// batch is rejected when remaining quota is less than the batch size, and
// the quota must remain unchanged (no partial debit).
it("rejects batch when remaining quota is less than batch size and does not debit", { timeout: 120_000 }, async ({ expect }) => {
  const { ownerTeamId } = await setupProjectWithPlan("free");
  await Auth.Otp.signIn();

  // Drain async logEvent debits before forcing the quota down to a known
  // value — otherwise a trailing in-flight debit would push it negative
  // after we set it to 2 and break the post-condition.
  //
  // `Auth.Otp.signIn()` triggers async events via `runAsynchronouslyAndWaitUntil`
  // (e.g. $token-refresh, $sign-up-rule-trigger) that debit analytics quota.
  // Under CI load with 8 parallel workers, these async callbacks can be delayed
  // 5+ seconds after the HTTP response. `minimumElapsedMs: 10_000` ensures we
  // don't declare stability before the async pipeline has had time to fire.
  await waitForItemQuantityToStabilize(
    ownerTeamId,
    ITEM_IDS.analyticsEvents,
    { minimumElapsedMs: 10_000 },
  );
  await setItemQuantity(ownerTeamId, ITEM_IDS.analyticsEvents, 2);

  const res = await uploadEventBatch({
    sessionReplaySegmentId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: Date.now(),
    events: Array.from({ length: 5 }, (_, i) => ({
      event_type: "$page-view" as const,
      event_at_ms: Date.now() - i,
      data: {},
    })),
  });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe("ITEM_QUANTITY_INSUFFICIENT_AMOUNT");

  const quantityAfter = await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsEvents);
  expect(quantityAfter).toBe(2);
});

it("free plan starts with correct analytics event allocation", async ({ expect }) => {
  const { ownerTeamId } = await setupProjectWithPlan("free");

  const quantity = await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsEvents);
  expect(quantity).toBe(PLAN_LIMITS.free.analyticsEvents);
});

it("team plan starts with correct analytics event allocation", async ({ expect }) => {
  const { ownerTeamId } = await setupProjectWithPlan("team");

  const quantity = await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsEvents);
  expect(quantity).toBe(PLAN_LIMITS.team.analyticsEvents);
});

it("free plan starts with correct analytics span allocation", async ({ expect }) => {
  const { ownerTeamId } = await setupProjectWithPlan("free");

  await waitForItemQuantityToReach(ownerTeamId, ITEM_IDS.analyticsSpans, PLAN_LIMITS.free.analyticsSpans);
  const quantity = await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsSpans);
  expect(quantity).toBe(PLAN_LIMITS.free.analyticsSpans);
});

it("debits spans against the analytics spans item, not analytics events", { timeout: 120_000 }, async ({ expect }) => {
  const { ownerTeamId } = await setupProjectWithPlan("free");
  await Auth.Otp.signIn();
  await waitForItemQuantityToReach(ownerTeamId, ITEM_IDS.analyticsSpans, PLAN_LIMITS.free.analyticsSpans);

  // Drain async logEvent debits (see the events debit test above for why).
  const eventsBefore = await waitForItemQuantityToStabilize(
    ownerTeamId,
    ITEM_IDS.analyticsEvents,
    { minimumElapsedMs: 5000 },
  );
  const spansBefore = await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsSpans);

  const now = Date.now();
  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_replay_segment_id: randomUUID(),
      batch_id: randomUUID(),
      sent_at_ms: now,
      spans: [
        { span_id: randomUUID(), span_type: "checkout-flow", started_at_ms: now - 1000, ended_at_ms: null, parent_span_ids: [], data: {}, updated_at_ms: now },
        { span_id: randomUUID(), span_type: "checkout-flow", started_at_ms: now - 500, ended_at_ms: null, parent_span_ids: [], data: {}, updated_at_ms: now },
      ],
    },
  });
  expect(res.status).toBe(200);
  expect(res.body.inserted).toBe(0);
  expect(res.body.accepted_spans).toBe(2);

  const spansAfter = await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsSpans);
  expect(spansAfter).toBe(spansBefore - 2);
  const eventsAfter = await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsEvents);
  expect(eventsAfter).toBe(eventsBefore);
});

it("rejects the whole batch when span quota is insufficient and refunds the events debit", { timeout: 120_000 }, async ({ expect }) => {
  const { ownerTeamId } = await setupProjectWithPlan("free");
  await Auth.Otp.signIn();
  await waitForItemQuantityToReach(ownerTeamId, ITEM_IDS.analyticsSpans, PLAN_LIMITS.free.analyticsSpans);

  // Drain async logEvent debits before pinning quantities (see comments above).
  await waitForItemQuantityToStabilize(
    ownerTeamId,
    ITEM_IDS.analyticsEvents,
    { minimumElapsedMs: 10_000 },
  );
  await setItemQuantity(ownerTeamId, ITEM_IDS.analyticsEvents, 10);
  await setItemQuantity(ownerTeamId, ITEM_IDS.analyticsSpans, 0);

  const now = Date.now();
  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_replay_segment_id: randomUUID(),
      batch_id: randomUUID(),
      sent_at_ms: now,
      events: [{ event_type: "$page-view", event_at_ms: now, data: {} }],
      spans: [
        { span_id: randomUUID(), span_type: "checkout-flow", started_at_ms: now - 1000, ended_at_ms: null, parent_span_ids: [], data: {}, updated_at_ms: now },
      ],
    },
  });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe("ITEM_QUANTITY_INSUFFICIENT_AMOUNT");

  // The events debit made before the failing spans debit must have been refunded.
  const eventsAfter = await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsEvents);
  expect(eventsAfter).toBe(10);
  const spansAfter = await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsSpans);
  expect(spansAfter).toBe(0);
});

// ============================================================================
// Custom events & custom spans
// ============================================================================

async function setupAnalyticsProject() {
  const project = await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  return project;
}

async function uploadTelemetryBatch(
  body: {
    session_replay_segment_id?: string,
    batch_id?: string,
    sent_at_ms?: number,
    user_id?: string,
    refresh_token_id?: string,
    session_replay_id?: string,
    events?: unknown[],
    spans?: unknown[],
  },
  options?: { accessType?: "client" | "server" },
) {
  return await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: options?.accessType ?? "client",
    body: {
      batch_id: randomUUID(),
      sent_at_ms: Date.now(),
      ...body,
    },
  });
}

async function uploadSessionReplayBatch(options: {
  browserSessionId: string,
  sessionReplaySegmentId: string,
  batchId: string,
  startedAtMs: number,
  sentAtMs: number,
}) {
  return await niceBackendFetch("/api/v1/session-replays/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: options.browserSessionId,
      session_replay_segment_id: options.sessionReplaySegmentId,
      batch_id: options.batchId,
      started_at_ms: options.startedAtMs,
      sent_at_ms: options.sentAtMs,
      events: [{ timestamp: options.startedAtMs + 100, type: 2 }],
    },
  });
}

function currentRefreshTokenId(): string {
  const accessToken = backendContext.value.userAuth?.accessToken;
  if (accessToken == null) throw new Error("Expected signed-in user auth before reading refresh token id");
  const payloadPart = accessToken.split(".").at(1);
  if (payloadPart == null) throw new Error("Expected JWT access token with payload");
  const parsed: unknown = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf-8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected JWT payload object");
  }
  if (!("refresh_token_id" in parsed)) {
    throw new Error("Expected access-token payload to include refresh_token_id");
  }
  const refreshTokenId = parsed.refresh_token_id;
  if (typeof refreshTokenId !== "string") {
    throw new Error("Expected access-token payload to include refresh_token_id");
  }
  return refreshTokenId;
}

function sessionReplayIdFromResponseBody(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("session_replay_id" in body)) {
    throw new Error("Expected session replay batch response to include session_replay_id");
  }
  const sessionReplayId = body.session_replay_id;
  if (typeof sessionReplayId !== "string") {
    throw new Error("Expected session_replay_id to be a string");
  }
  return sessionReplayId;
}

function makeCustomSpan(overrides?: Record<string, unknown>) {
  const now = Date.now();
  return {
    span_id: randomUUID(),
    span_type: "checkout-flow",
    started_at_ms: now - 1000,
    ended_at_ms: null,
    parent_span_ids: [],
    data: {},
    updated_at_ms: now,
    ...overrides,
  };
}

// Retry query because both the events insert (async_insert) and the spans
// insert (written off the response path via waitUntil) land with a delay.
async function queryAnalyticsUntil(
  body: { query: string, params?: Record<string, string> },
  isDone: (res: { status: number, body: any }) => boolean,
  attempts = 20,
) {
  let queryRes;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await wait(500);
    queryRes = await niceBackendFetch("/api/v1/internal/analytics/query", {
      method: "POST",
      accessType: "admin",
      body,
    });
    if (queryRes.status === 200 && isDone(queryRes)) {
      break;
    }
  }
  return queryRes;
}

it("accepts custom events and stamps system ancestry on them", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const now = Date.now();
  const res = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    events: [{ event_type: "checkout_completed", event_at_ms: now - 100, data: { cart_size: 3 } }],
  });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "inserted": 1, "accepted_spans": 0 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT event_type, parent_span_ids FROM events WHERE session_replay_segment_id = {segId:String}",
    params: { segId: sessionReplaySegmentId },
  }, (r) => r.body?.result?.length === 1);

  expect(queryRes?.status).toBe(200);
  const row = (queryRes?.body as any).result[0];
  expect(row.event_type).toBe("checkout_completed");
  // No active session replay, so the only system ancestor is the refresh-token span.
  expect(row.parent_span_ids).toHaveLength(1);
  expect(row.parent_span_ids[0]).toMatch(/^rti-/);
});

it("server-auth telemetry parents under the forwarded client-session context", async ({ expect }) => {
  // A server span opened with withSpan({ request }) forwards the caller's resolved
  // context (refresh token from the session, replay/segment from the propagation
  // header) as scalars; the backend composes the full $refresh-token/$session-replay/
  // $session-replay-segment ancestry and stamps the scalar columns, exactly like a
  // browser event — even though the batch is sent with the secret server key.
  await setupAnalyticsProject();
  await Auth.Otp.signIn();
  const me = await niceBackendFetch("/api/v1/users/me", { accessType: "client" });
  const userId = me.body.id as string;

  const sessionReplaySegmentId = randomUUID();
  const replayBatch = await uploadSessionReplayBatch({
    browserSessionId: randomUUID(),
    sessionReplaySegmentId,
    batchId: randomUUID(),
    startedAtMs: Date.now() - 1_000,
    sentAtMs: Date.now(),
  });
  expect(replayBatch.status).toBe(200);
  const refreshTokenId = currentRefreshTokenId();
  const sessionReplayId = sessionReplayIdFromResponseBody(replayBatch.body);
  const customParent = randomUUID();
  const now = Date.now();

  const res = await uploadTelemetryBatch({
    user_id: userId,
    refresh_token_id: refreshTokenId,
    session_replay_id: sessionReplayId,
    session_replay_segment_id: sessionReplaySegmentId,
    events: [{ event_type: "server_action", event_at_ms: now - 100, data: { ok: true }, parent_span_ids: [customParent] }],
  }, { accessType: "server" });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ inserted: 1, accepted_spans: 0 });

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT event_type, parent_span_ids, refresh_token_id, session_replay_id, session_replay_segment_id, user_id FROM events WHERE session_replay_segment_id = {segId:String}",
    params: { segId: sessionReplaySegmentId },
  }, (r) => r.body?.result?.length === 1);

  expect(queryRes?.status).toBe(200);
  const row = (queryRes?.body as any).result[0];
  expect(row.event_type).toBe("server_action");
  // Root-first system ancestry composed server-side, then the custom parent (cs-).
  expect(row.parent_span_ids).toEqual([
    `rti-${refreshTokenId}`,
    `sri-${sessionReplayId}`,
    `srsi-${sessionReplayId}:${sessionReplaySegmentId}`,
    `cs-${customParent}`,
  ]);
  // Scalar columns are stamped too (not just parent_span_ids), so replay filtering works.
  expect(row.refresh_token_id).toBe(refreshTokenId);
  expect(row.session_replay_id).toBe(sessionReplayId);
  expect(row.session_replay_segment_id).toBe(sessionReplaySegmentId);
  expect(row.user_id).toBe(userId);
});

it("rejects forwarded server replay context without the matching refresh-token root", async ({ expect }) => {
  const { createProjectResponse } = await setupAnalyticsProject();
  await Auth.Otp.signIn();
  const ownerTeamId = createProjectResponse.body.owner_team_id;
  const [eventsBefore, spansBefore] = await Promise.all([
    waitForItemQuantityToStabilize(ownerTeamId, ITEM_IDS.analyticsEvents, { minimumElapsedMs: 5000 }),
    waitForItemQuantityToStabilize(ownerTeamId, ITEM_IDS.analyticsSpans, { minimumElapsedMs: 5000 }),
  ]);
  const sessionReplaySegmentId = randomUUID();
  const replayBatch = await uploadSessionReplayBatch({
    browserSessionId: randomUUID(),
    sessionReplaySegmentId,
    batchId: randomUUID(),
    startedAtMs: Date.now() - 1_000,
    sentAtMs: Date.now(),
  });
  expect(replayBatch.status).toBe(200);
  const sessionReplayId = sessionReplayIdFromResponseBody(replayBatch.body);

  const noRefresh = await uploadTelemetryBatch({
    session_replay_id: sessionReplayId,
    session_replay_segment_id: sessionReplaySegmentId,
    events: [{ event_type: "server_action", event_at_ms: Date.now(), data: {} }],
  }, { accessType: "server" });
  expect(noRefresh.status).toBe(400);
  expect(noRefresh.body).toBe("session_replay_id requires refresh_token_id");

  const wrongRefresh = await uploadTelemetryBatch({
    refresh_token_id: randomUUID(),
    session_replay_id: sessionReplayId,
    session_replay_segment_id: sessionReplaySegmentId,
    events: [{ event_type: "server_action", event_at_ms: Date.now(), data: {} }],
  }, { accessType: "server" });
  expect(wrongRefresh.status).toBe(400);
  expect(wrongRefresh.body).toBe("session_replay_id does not correspond to the forwarded refresh token and user");
  expect(await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsEvents)).toBe(eventsBefore);
  expect(await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsSpans)).toBe(spansBefore);
});

it("does not derive a fallback replay from another user when server auth supplies user_id", async ({ expect }) => {
  await setupAnalyticsProject();
  const firstUser = await Auth.fastSignUp();
  const refreshTokenId = currentRefreshTokenId();
  const sessionReplaySegmentId = randomUUID();
  const replayBatch = await uploadSessionReplayBatch({
    browserSessionId: randomUUID(),
    sessionReplaySegmentId,
    batchId: randomUUID(),
    startedAtMs: Date.now() - 1_000,
    sentAtMs: Date.now(),
  });
  expect(replayBatch.status).toBe(200);
  const secondUser = await Auth.fastSignUp();
  const serverSegmentId = randomUUID();

  const res = await uploadTelemetryBatch({
    user_id: secondUser.userId,
    refresh_token_id: refreshTokenId,
    session_replay_segment_id: serverSegmentId,
    events: [{ event_type: "server_action", event_at_ms: Date.now(), data: { ok: true } }],
  }, { accessType: "server" });
  expect(res.status).toBe(200);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT user_id, refresh_token_id, session_replay_id, parent_span_ids FROM events WHERE session_replay_segment_id = {segId:String}",
    params: { segId: serverSegmentId },
  }, (r) => r.body?.result?.length === 1);

  expect(queryRes?.status).toBe(200);
  const row = (queryRes?.body as any).result[0];
  expect(row.user_id).toBe(secondUser.userId);
  expect(row.refresh_token_id).toBe(refreshTokenId);
  expect(row.session_replay_id).toBeNull();
  // Segment id is still stamped even when the replay cannot be resolved (here the
  // forwarded refresh token belongs to a different user than the batch's user_id).
  expect(row.parent_span_ids).toEqual([`rti-${refreshTokenId}`, `srsi-${serverSegmentId}`]);
  expect(firstUser.userId).not.toBe(secondUser.userId);
});

it("rejects the forwarded server context under client auth", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();
  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    refresh_token_id: randomUUID(),
    events: [{ event_type: "$page-view", event_at_ms: Date.now(), data: {} }],
  }, { accessType: "client" });
  expect(res.status).toBe(400);
});

it("appends the client-supplied custom parent chain after system ancestry on events", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const parentSpanId = randomUUID();
  const now = Date.now();
  const res = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    events: [{
      event_type: "checkout_step",
      event_at_ms: now - 100,
      data: { step: 1 },
      parent_span_ids: [parentSpanId],
    }],
  });
  expect(res.status).toBe(200);
  expect(res.body.inserted).toBe(1);
  expect(res.body.accepted_spans).toBe(0);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT parent_span_ids FROM events WHERE session_replay_segment_id = {segId:String}",
    params: { segId: sessionReplaySegmentId },
  }, (r) => r.body?.result?.length === 1);

  expect(queryRes?.status).toBe(200);
  const row = (queryRes?.body as any).result[0];
  // Root-first: system ancestry (refresh-token) first, then the cs-prefixed custom chain.
  expect(row.parent_span_ids).toHaveLength(2);
  expect(row.parent_span_ids[0]).toMatch(/^rti-/);
  expect(row.parent_span_ids[1]).toBe(`cs-${parentSpanId}`);
});

it("rejects unknown $-prefixed event types", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "$custom-fake", event_at_ms: Date.now(), data: {} }],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
  expect(res.body?.error).toContain("event_type must be one of");
});

it("rejects custom event types that do not start with a letter", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "1bad", event_at_ms: Date.now(), data: {} }],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
  expect(res.body?.error).toContain("event_type must be one of");
});

it("rejects custom event types longer than 64 characters", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "a".repeat(65), event_at_ms: Date.now(), data: {} }],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
  expect(res.body?.error).toContain("event_type must be one of");
});

it("rejects custom event data that is not a plain object", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "checkout_completed", event_at_ms: Date.now(), data: [1, 2, 3] }],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
  expect(res.body?.error).toContain("Event data must be a JSON object");
});

it("rejects custom event data larger than the serialized size cap", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "checkout_completed", event_at_ms: Date.now(), data: { pad: "x".repeat(16_001) } }],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
  expect(res.body?.error).toContain("Event data must be a JSON object");
});

it("rejects custom event data whose UTF-8 bytes exceed the serialized size cap", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "checkout_completed", event_at_ms: Date.now(), data: { pad: "é".repeat(8_000) } }],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
  expect(res.body?.error).toContain("Event data must be a JSON object");
});

it("rejects $-prefixed span types outside the client-writable system list", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  for (const spanType of ["$reserved", "$session-replay", "$refresh-token"]) {
    const res = await uploadTelemetryBatch({
      session_replay_segment_id: randomUUID(),
      spans: [makeCustomSpan({ span_type: spanType })],
    });

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("SCHEMA_ERROR");
    expect(res.body?.error).toContain("span_type must be one of");
  }
});

it("accepts a $page-view span (pv- id) with nested system autocapture and custom spans (page ancestry between system and custom)", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const pageViewSpanId = randomUUID();
  const awaySpanId = randomUUID();
  const customSpanId = randomUUID();
  const customParent = randomUUID();
  const now = Date.now();

  const res = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    spans: [
      makeCustomSpan({ span_id: pageViewSpanId, span_type: "$page-view", data: { path: "/exam", entry_type: "initial" } }),
      makeCustomSpan({ span_id: awaySpanId, span_type: "$away", page_view_span_id: pageViewSpanId, data: { reasons: ["tab-hidden"] } }),
      makeCustomSpan({ span_id: customSpanId, page_view_span_id: pageViewSpanId, parent_span_ids: [customParent] }),
    ],
    events: [{
      event_type: "$paste",
      event_at_ms: now - 100,
      data: { length: 12, same_page_origin: 0 },
      page_view_span_id: pageViewSpanId,
    }],
  });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ inserted: 1, accepted_spans: 3 });

  const spanQueryRes = await queryAnalyticsUntil({
    query: "SELECT id, span_type, parent_span_ids FROM spans WHERE session_replay_segment_id = {segId:String} ORDER BY id",
    params: { segId: sessionReplaySegmentId },
  }, (r) => r.body?.result?.length === 3);
  expect(spanQueryRes?.status).toBe(200);
  const spanRows = (spanQueryRes?.body as any).result as { id: string, span_type: string, parent_span_ids: string[] }[];

  const pageViewRow = spanRows.find((row) => row.id === `pv-${pageViewSpanId}`);
  expect(pageViewRow?.span_type).toBe("$page-view");
  // The page-view span itself parents only under the system ancestry
  // (refresh-token here — no active replay).
  expect(pageViewRow?.parent_span_ids).toHaveLength(1);
  expect(pageViewRow?.parent_span_ids[0]).toMatch(/^rti-/);

  const awayRow = spanRows.find((row) => row.id === `sas-${awaySpanId}`);
  expect(awayRow?.span_type).toBe("$away");
  expect(awayRow?.parent_span_ids).toEqual([
    pageViewRow!.parent_span_ids[0],
    `pv-${pageViewSpanId}`,
  ]);

  // Custom span: system ancestry, then the page, then the custom chain.
  const customRow = spanRows.find((row) => row.id === `cs-${customSpanId}`);
  expect(customRow?.parent_span_ids).toEqual([
    pageViewRow!.parent_span_ids[0],
    `pv-${pageViewSpanId}`,
    `cs-${customParent}`,
  ]);

  // The new system EVENT type nests under the page too.
  const eventQueryRes = await queryAnalyticsUntil({
    query: "SELECT event_type, parent_span_ids FROM events WHERE session_replay_segment_id = {segId:String}",
    params: { segId: sessionReplaySegmentId },
  }, (r) => r.body?.result?.length === 1);
  expect(eventQueryRes?.status).toBe(200);
  const eventRow = (eventQueryRes?.body as any).result[0];
  expect(eventRow.event_type).toBe("$paste");
  expect(eventRow.parent_span_ids).toEqual([
    pageViewRow!.parent_span_ids[0],
    `pv-${pageViewSpanId}`,
  ]);
});

it("rejects a $page-view span carrying page or custom ancestry and a span naming itself as its page", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const pageViewSpanId = randomUUID();
  const nested = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    spans: [makeCustomSpan({ span_id: pageViewSpanId, span_type: "$page-view", page_view_span_id: randomUUID() })],
  });
  expect(nested.status).toBe(400);
  expect(nested.body?.code).toBe("SCHEMA_ERROR");
  expect(nested.body?.error).toContain("A $page-view span must not carry page_view_span_id or parent_span_ids");

  const customParented = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    spans: [makeCustomSpan({ span_id: pageViewSpanId, span_type: "$page-view", parent_span_ids: [randomUUID()] })],
  });
  expect(customParented.status).toBe(400);
  expect(customParented.body?.error).toContain("A $page-view span must not carry page_view_span_id or parent_span_ids");

  const selfReferencing = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    spans: [makeCustomSpan({ span_id: pageViewSpanId, span_type: "$away", page_view_span_id: pageViewSpanId })],
  });
  expect(selfReferencing.status).toBe(400);
  expect(selfReferencing.body?.code).toBe("SCHEMA_ERROR");
  expect(selfReferencing.body?.error).toContain("must not name itself as its page_view_span_id");
});

it("rejects invalid page_view_span_id values on events and spans", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const badEvent = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "$click", event_at_ms: Date.now(), data: {}, page_view_span_id: "not-a-uuid" }],
  });
  expect(badEvent.status).toBe(400);
  expect(badEvent.body?.error).toContain("Invalid page_view_span_id");

  const badSpan = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    spans: [makeCustomSpan({ page_view_span_id: "not-a-uuid" })],
  });
  expect(badSpan.status).toBe(400);
  expect(badSpan.body?.error).toContain("Invalid page_view_span_id");
});

it("applies the data size cap to NEW system event types (only $page-view/$click stay permissive)", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  // A new system type with oversized data is rejected like a custom event…
  const oversizedNew = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "$form-submit", event_at_ms: Date.now(), data: { pad: "x".repeat(16_001) } }],
  });
  expect(oversizedNew.status).toBe(400);
  expect(oversizedNew.body?.error).toContain("Event data must be a JSON object");

  // …while the two legacy types stay permissive for deployed-tracker back-compat.
  const oversizedLegacy = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "$click", event_at_ms: Date.now(), data: { pad: "x".repeat(16_001) } }],
  });
  expect(oversizedLegacy.status).toBe(200);
});

it("rejects spans that end before they start", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const now = Date.now();
  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    spans: [makeCustomSpan({ started_at_ms: now, ended_at_ms: now - 1000 })],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
  expect(res.body?.error).toContain("ended_at_ms must be greater than or equal to started_at_ms");
});

it("rejects a batch with neither events nor spans", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
  expect(res.body?.error).toContain("A batch must contain at least one event or span");
});

it("rejects user_id with client auth", async ({ expect }) => {
  await setupAnalyticsProject();
  const { userId } = await Auth.Otp.signIn();

  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    user_id: userId,
    events: [{ event_type: "checkout_completed", event_at_ms: Date.now(), data: {} }],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
  expect(res.body?.error).toContain("user_id / refresh_token_id / session_replay_id must not be set with client auth; they are derived from the session");
});

it("rejects client-auth batches without session_replay_segment_id", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const res = await uploadTelemetryBatch({
    events: [{ event_type: "checkout_completed", event_at_ms: Date.now(), data: {} }],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
  expect(res.body?.error).toContain("session_replay_segment_id is required for analytics batches with client auth");
});

it("accepts a spans-only batch and lands it on the spans surface", async ({ expect }) => {
  await setupAnalyticsProject();
  const { userId } = await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const spanId = randomUUID();
  const now = Date.now();
  const res = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    spans: [{
      span_id: spanId,
      span_type: "checkout-flow",
      started_at_ms: now - 1000,
      ended_at_ms: null,
      parent_span_ids: [],
      data: {},
      updated_at_ms: now,
    }],
  });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "inserted": 0, "accepted_spans": 1 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT id, span_type, span_ended_at, parent_span_ids, user_id, session_replay_segment_id FROM spans WHERE id = {id:String}",
    params: { id: `cs-${spanId}` },
  }, (r) => r.body?.result?.length === 1);

  expect(queryRes?.status).toBe(200);
  const rows = (queryRes?.body as any).result;
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(`cs-${spanId}`);
  expect(rows[0].span_type).toBe("checkout-flow");
  // The span is still open.
  expect(rows[0].span_ended_at).toBeNull();
  // No active session replay, so the only system ancestor is the refresh-token span.
  expect(rows[0].parent_span_ids).toHaveLength(1);
  expect(rows[0].parent_span_ids[0]).toMatch(/^rti-/);
  expect(rows[0].user_id).toBe(userId);
  expect(rows[0].session_replay_segment_id).toBe(sessionReplaySegmentId);
});

it("collapses open→closed span re-writes to the ended row", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const spanId = randomUUID();
  const now = Date.now();
  const startedAtMs = now - 10_000;
  const endedAtMs = now - 2000;
  const openUpdatedAtMs = now - 9000;
  const closedUpdatedAtMs = now - 1000;

  const openRes = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    spans: [makeCustomSpan({ span_id: spanId, started_at_ms: startedAtMs, ended_at_ms: null, updated_at_ms: openUpdatedAtMs })],
  });
  expect(openRes.status).toBe(200);

  const openQueryRes = await queryAnalyticsUntil({
    query: "SELECT id, span_ended_at FROM spans WHERE id = {id:String}",
    params: { id: `cs-${spanId}` },
  }, (r) => r.body?.result?.length === 1);
  expect(openQueryRes?.status).toBe(200);
  expect((openQueryRes?.body as any).result[0].span_ended_at).toBeNull();

  const closedRes = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    spans: [makeCustomSpan({ span_id: spanId, started_at_ms: startedAtMs, ended_at_ms: endedAtMs, updated_at_ms: closedUpdatedAtMs })],
  });
  expect(closedRes.status).toBe(200);

  // The view reads FINAL, so the two versions collapse to the ended row.
  const closedQueryRes = await queryAnalyticsUntil({
    query: "SELECT id, span_ended_at FROM spans WHERE id = {id:String}",
    params: { id: `cs-${spanId}` },
  }, (r) => r.body?.result?.length === 1 && r.body.result[0].span_ended_at != null);
  expect(closedQueryRes?.status).toBe(200);
  const rows = (closedQueryRes?.body as any).result;
  expect(rows).toHaveLength(1);
  expect(rows[0].span_ended_at).not.toBeNull();
});

it("keeps the ended row when an open re-write arrives with an older version (out-of-order)", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const spanId = randomUUID();
  const sentinelSpanId = randomUUID();
  const now = Date.now();
  const startedAtMs = now - 10_000;
  const endedAtMs = now - 2000;
  const openUpdatedAtMs = now - 9000;
  const closedUpdatedAtMs = now - 1000;

  // The END row arrives first, carrying the LATER version…
  const closedRes = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    spans: [makeCustomSpan({ span_id: spanId, started_at_ms: startedAtMs, ended_at_ms: endedAtMs, updated_at_ms: closedUpdatedAtMs })],
  });
  expect(closedRes.status).toBe(200);

  const closedQueryRes = await queryAnalyticsUntil({
    query: "SELECT id, span_ended_at FROM spans WHERE id = {id:String}",
    params: { id: `cs-${spanId}` },
  }, (r) => r.body?.result?.length === 1);
  expect(closedQueryRes?.status).toBe(200);
  expect((closedQueryRes?.body as any).result[0].span_ended_at).not.toBeNull();

  // …then a stale OPEN row with the EARLIER version arrives. The sentinel span
  // rides in the same batch (same ClickHouse insert), so once it is visible the
  // stale open row has landed too.
  const staleOpenRes = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    spans: [
      makeCustomSpan({ span_id: spanId, started_at_ms: startedAtMs, ended_at_ms: null, updated_at_ms: openUpdatedAtMs }),
      makeCustomSpan({ span_id: sentinelSpanId }),
    ],
  });
  expect(staleOpenRes.status).toBe(200);

  const sentinelQueryRes = await queryAnalyticsUntil({
    query: "SELECT id FROM spans WHERE id = {id:String}",
    params: { id: `cs-${sentinelSpanId}` },
  }, (r) => r.body?.result?.length === 1);
  expect(sentinelQueryRes?.status).toBe(200);

  // The ended row still wins: version (updated_at_ms) decides, not insert order.
  const finalQueryRes = await queryAnalyticsUntil({
    query: "SELECT id, span_ended_at FROM spans WHERE id = {id:String}",
    params: { id: `cs-${spanId}` },
  }, (r) => r.body?.result?.length === 1);
  expect(finalQueryRes?.status).toBe(200);
  const rows = (finalQueryRes?.body as any).result;
  expect(rows).toHaveLength(1);
  expect(rows[0].span_ended_at).not.toBeNull();
});

it("accepts server-key batches with explicit user_id and no system ancestry", async ({ expect }) => {
  await setupAnalyticsProject();
  const { userId } = await Auth.Otp.signIn();
  // Server-key request: no user access token, no refresh token.
  backendContext.set({ userAuth: null });

  const eventType = `sk-${randomUUID()}`;
  const res = await uploadTelemetryBatch({
    user_id: userId,
    events: [{ event_type: eventType, event_at_ms: Date.now(), data: { source: "server" } }],
  }, { accessType: "server" });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "inserted": 1, "accepted_spans": 0 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT user_id, parent_span_ids FROM events WHERE event_type = {eventType:String}",
    params: { eventType },
  }, (r) => r.body?.result?.length === 1);

  expect(queryRes?.status).toBe(200);
  const row = (queryRes?.body as any).result[0];
  expect(row.user_id).toBe(userId);
  // No session on server auth, so there is no system ancestry at all.
  expect(row.parent_span_ids).toEqual([]);
});

it("rejects server-key batches with an unknown user_id", async ({ expect }) => {
  await setupAnalyticsProject();
  backendContext.set({ userAuth: null });

  const res = await uploadTelemetryBatch({
    user_id: randomUUID(),
    events: [{ event_type: "checkout_completed", event_at_ms: Date.now(), data: {} }],
  }, { accessType: "server" });

  expect(res.status).toBe(400);
  expect(res.body).toBe("user_id does not correspond to a user on this project/branch");
});

it("accepts server-key spans without refresh-token ancestry", async ({ expect }) => {
  await setupAnalyticsProject();
  const { userId } = await Auth.Otp.signIn();
  backendContext.set({ userAuth: null });

  const spanId = randomUUID();
  const res = await uploadTelemetryBatch({
    user_id: userId,
    spans: [makeCustomSpan({ span_id: spanId })],
  }, { accessType: "server" });
  expect(res.status).toBe(200);
  expect(res.body.inserted).toBe(0);
  expect(res.body.accepted_spans).toBe(1);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT id, span_type, parent_span_ids, user_id FROM spans WHERE id = {id:String}",
    params: { id: `cs-${spanId}` },
  }, (r) => r.body?.result?.length === 1);

  expect(queryRes?.status).toBe(200);
  const rows = (queryRes?.body as any).result;
  expect(rows).toHaveLength(1);
  expect(rows[0].span_type).toBe("checkout-flow");
  expect(rows[0].user_id).toBe(userId);
  // No refresh token on server auth → no rti- (or any system) ancestor.
  expect(rows[0].parent_span_ids).toEqual([]);
});

it("accepts a gzipped binary body containing custom events and spans", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const now = Date.now();
  const payload = {
    session_replay_segment_id: randomUUID(),
    batch_id: randomUUID(),
    sent_at_ms: now,
    events: [{ event_type: "checkout_completed", event_at_ms: now - 100, data: { cart_size: 3 } }],
    spans: [makeCustomSpan()],
  };
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf-8"));

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    rawBody: compressed,
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "inserted": 1, "accepted_spans": 1 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
