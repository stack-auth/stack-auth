import { ITEM_IDS, PLAN_LIMITS, type PlanId } from "@hexclave/shared/dist/plans";
import { CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES, generateW3cSpanId, generateW3cTraceId } from "@hexclave/shared/dist/utils/analytics-wire";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { wait } from "@hexclave/shared/dist/utils/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { it } from "../../../../helpers";
import { Auth, INTERNAL_PROJECT_OWNER_TEAM_ID, Project, backendContext, niceBackendFetch, withInternalProject } from "../../../backend-helpers";
import {
  getItemQuantity,
  setItemQuantity,
  waitForItemQuantityToReach,
  waitForItemQuantityToStabilize,
} from "../../../payment-quota-helpers";

const DEFAULT_TELEMETRY_RESOURCE = {
  service: { namespace: "e2e", name: "test-client", version: "test" },
  deploymentEnvironmentName: "test",
  attributes: { suite: "analytics-events-batch" },
} as const;

const DEFAULT_TELEMETRY_BATCH_FIELDS = {
  schema_version: 3,
  resource: DEFAULT_TELEMETRY_RESOURCE,
} as const;

/**
 * The session-replay batch is versioned INDEPENDENTLY of the events/spans batch
 * and is still at 2: its body carries rrweb chunks, and that shape did not change
 * when span identity moved to W3C. Sending 3 here is rejected by the route, so
 * these fields cannot be shared with DEFAULT_TELEMETRY_BATCH_FIELDS.
 */
const DEFAULT_REPLAY_BATCH_FIELDS = {
  schema_version: 2,
  resource: DEFAULT_TELEMETRY_RESOURCE,
} as const;

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
      ...DEFAULT_TELEMETRY_BATCH_FIELDS,
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
      ...DEFAULT_TELEMETRY_BATCH_FIELDS,
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

// Regression test: the request-level auth-type tests in the batch route's schema
// used to dereference `req.auth.type` while yup was still reporting the
// missing-auth nullability error, turning an unauthenticated request into a 500.
it("returns ACCESS_TYPE_REQUIRED instead of crashing when no project access is provided", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    body: {
      ...DEFAULT_TELEMETRY_BATCH_FIELDS,
      session_replay_segment_id: randomUUID(),
      batch_id: randomUUID(),
      sent_at_ms: Date.now(),
      events: [{ event_type: "$page-view", event_at_ms: Date.now(), data: {} }],
    },
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ACCESS_TYPE_REQUIRED",
        "error": deindent\`
          You must specify an access level for this Hexclave project. Make sure project API keys are provided (eg. x-hexclave-publishable-client-key) and you set the x-hexclave-access-type header to 'client', 'server', or 'admin'. (The legacy x-stack-* equivalents are also accepted.)

          For more information, see the docs on REST API authentication: https://docs.hexclave.com/api/overview#authentication
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ACCESS_TYPE_REQUIRED",
        <some fields may have been hidden>,
      },
    }
  `);
});

// Regression test: same schema tests used to dereference `req.body.<field>` on a
// literal `null` JSON body (valid JSON, parsed to null) and crash with a 500.
it("rejects a literal null JSON body instead of crashing", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    rawBody: new TextEncoder().encode("null"),
    rawContentType: "application/json",
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/analytics/events/batch:
              - body cannot be null
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/analytics/events/batch:
            - body cannot be null
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

// Regression test: yup runs a parent object's own tests even when its children
// are failing validation, so the batch-level cross-item test (today the
// duplicate-span-id check) sees the RAW span array — including entries that are
// not objects at all. Reading `span.span_id` off those used to throw a 500
// before the item's own nullability error could be reported.
it("rejects null span items instead of crashing", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      ...DEFAULT_TELEMETRY_BATCH_FIELDS,
      session_replay_segment_id: randomUUID(),
      batch_id: randomUUID(),
      sent_at_ms: Date.now(),
      spans: [null],
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
              - body.spans[0] cannot be null
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/analytics/events/batch:
            - body.spans[0] cannot be null
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

// Regression test: `parent_span_id` is required-but-nullable, and the span
// item's own object-level tests (parent != self, page_view_span_id != self) run
// even while a required field is missing. They must therefore tolerate the
// absent field and let the field-level `must be defined` error be the answer,
// rather than dereferencing it and crashing with a 500.
it("rejects a span missing parent_span_id instead of crashing", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      ...DEFAULT_TELEMETRY_BATCH_FIELDS,
      session_replay_segment_id: randomUUID(),
      batch_id: randomUUID(),
      sent_at_ms: Date.now(),
      spans: [{
        trace_id: generateW3cTraceId(),
        span_id: generateW3cSpanId(),
        span_type: "$page-view",
        started_at_ms: Date.now(),
        ended_at_ms: null,
        data: {},
        updated_at_ms: Date.now(),
      }],
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
              - body.spans[0].parent_span_id must be defined
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/analytics/events/batch:
            - body.spans[0].parent_span_id must be defined
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("throws error when analytics is not enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  // Analytics is disabled by default - do NOT call Project.updateConfig
  await Auth.fastSignUp();

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
  await Auth.fastSignUp();

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
      "body": {
        "accepted_spans": 0,
        "inserted": 2,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("accepts valid $click events", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.fastSignUp();

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
      "body": {
        "accepted_spans": 0,
        "inserted": 1,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("accepts privacy-safe debounced $keystroke events", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const now = Date.now();
  const res = await uploadEventBatch({
    sessionReplaySegmentId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: now,
    events: [{
      event_type: "$keystroke",
      event_at_ms: now - 500,
      data: {
        count: 7,
        duration_ms: 420,
        url: "https://example.com/search",
        path: "/search",
      },
    }],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "accepted_spans": 0,
        "inserted": 1,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("accepts a gzipped binary body (adblocker-evasion encoding)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.fastSignUp();

  const now = Date.now();
  const payload = {
    ...DEFAULT_TELEMETRY_BATCH_FIELDS,
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
      "body": {
        "accepted_spans": 0,
        "inserted": 1,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("rejects a binary body that isn't valid gzip", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.fastSignUp();

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
  await Auth.fastSignUp();

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
  await Auth.fastSignUp();

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
  await Auth.fastSignUp();

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
      "body": {
        "accepted_spans": 0,
        "inserted": 1,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("rejects empty events array", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.fastSignUp();

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
  await Auth.fastSignUp();

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
  await Auth.fastSignUp();

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      ...DEFAULT_TELEMETRY_BATCH_FIELDS,
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
  await Auth.fastSignUp();

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      ...DEFAULT_TELEMETRY_BATCH_FIELDS,
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
  await Auth.fastSignUp();

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      ...DEFAULT_TELEMETRY_BATCH_FIELDS,
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
              - event_type must be one of $page-view, $click, $keystroke, $form-submit, $window-resize, $copy, $cut, $paste, $context-menu, $print, $fullscreen-exit, $error, $log or a custom name matching /^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/analytics/events/batch:
            - event_type must be one of $page-view, $click, $keystroke, $form-submit, $window-resize, $copy, $cut, $paste, $context-menu, $print, $fullscreen-exit, $error, $log or a custom name matching /^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/
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
  await Auth.fastSignUp();

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
      "body": {
        "accepted_spans": 0,
        "inserted": 2,
      },
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

it("leaves trace/span correlation null for an event with no enclosing span", async ({ expect }) => {
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
    queryRes = await niceBackendFetch("/api/v1/analytics/query", {
      method: "POST",
      accessType: "admin",
      body: {
        query: "SELECT trace_id, span_id, session_replay_id FROM events WHERE session_replay_segment_id = {segId:String}",
        params: { segId: sessionReplaySegmentId },
      },
    });
    if (queryRes.status === 200 && queryRes.body?.result?.length === 1) {
      break;
    }
  }

  expect(queryRes?.status).toBe(200);
  const row = (queryRes?.body as any).result[0];
  // An event's trace_id/span_id name the span it happened INSIDE — they are not
  // synthesized server-side. This batch declared no enclosing span, so both stay
  // null and the row is correlated purely by session/segment scalars. (The
  // refresh token is likewise no longer an ancestor: it is a session, not an
  // operation, so it never appears in the hierarchy.)
  expect(row.trace_id).toBeNull();
  expect(row.span_id).toBeNull();
  // No active session replay for this user; the per-tab id lives in
  // session_replay_segment_id.
  expect(row.session_replay_id).toBeNull();
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

it("allows only one concurrent batch to spend the final analytics event credit", { timeout: 120_000 }, async ({ expect }) => {
  const { ownerTeamId } = await setupProjectWithPlan("free");
  await Auth.Otp.signIn();

  // Let sign-in's asynchronous internal events finish before pinning the final
  // credit; otherwise they are legitimate competing debits in this race.
  await waitForItemQuantityToStabilize(
    ownerTeamId,
    ITEM_IDS.analyticsEvents,
    { minimumElapsedMs: 10_000 },
  );
  await setItemQuantity(ownerTeamId, ITEM_IDS.analyticsEvents, 1);
  await waitForItemQuantityToReach(ownerTeamId, ITEM_IDS.analyticsEvents, 1);

  const sessionReplaySegmentId = randomUUID();
  const sentAtMs = Date.now();
  const responses = await Promise.all([randomUUID(), randomUUID()].map(async (batchId) => (
    await uploadEventBatch({
      sessionReplaySegmentId,
      batchId,
      sentAtMs,
      events: [{ event_type: "concurrent_final_credit", event_at_ms: sentAtMs, data: {} }],
    })
  )));

  expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 400]);
  const rejected = responses.find((response) => response.status === 400);
  expect(rejected?.body.code).toBe("ITEM_QUANTITY_INSUFFICIENT_AMOUNT");
  expect(await getItemQuantity(ownerTeamId, ITEM_IDS.analyticsEvents)).toBe(0);
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
      ...DEFAULT_TELEMETRY_BATCH_FIELDS,
      session_replay_segment_id: randomUUID(),
      batch_id: randomUUID(),
      sent_at_ms: now,
      spans: [
        { trace_id: generateW3cTraceId(), span_id: generateW3cSpanId(), parent_span_id: null, span_type: "checkout-flow", started_at_ms: now - 1000, ended_at_ms: null, data: {}, updated_at_ms: now },
        { trace_id: generateW3cTraceId(), span_id: generateW3cSpanId(), parent_span_id: null, span_type: "checkout-flow", started_at_ms: now - 500, ended_at_ms: null, data: {}, updated_at_ms: now },
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

it("rejects the whole batch when span quota is insufficient without partially debiting events", { timeout: 120_000 }, async ({ expect }) => {
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
      ...DEFAULT_TELEMETRY_BATCH_FIELDS,
      session_replay_segment_id: randomUUID(),
      batch_id: randomUUID(),
      sent_at_ms: now,
      events: [{ event_type: "$page-view", event_at_ms: now, data: {} }],
      spans: [
        { trace_id: generateW3cTraceId(), span_id: generateW3cSpanId(), parent_span_id: null, span_type: "checkout-flow", started_at_ms: now - 1000, ended_at_ms: null, data: {}, updated_at_ms: now },
      ],
    },
  });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe("ITEM_QUANTITY_INSUFFICIENT_AMOUNT");

  // The shared quantity snapshot rejects the batch before either item changes.
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
    schema_version?: number,
    resource?: unknown,
    sent_at_ms?: number,
    user_id?: string,
    refresh_token_id?: string,
    session_replay_id?: string,
    events?: unknown[],
    spans?: unknown[],
  },
  options?: {
    accessType?: "client" | "server",
    userAuth?: { accessToken?: string, refreshToken?: string },
  },
) {
  return await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: options?.accessType ?? "client",
    userAuth: options?.userAuth,
    body: {
      ...DEFAULT_TELEMETRY_BATCH_FIELDS,
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
      ...DEFAULT_REPLAY_BATCH_FIELDS,
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

// A minimal valid wire span: its own trace, no parent (i.e. a trace root).
// Callers that want a hierarchy pass an explicit `trace_id` + `parent_span_id`
// pair — the server never mints or rewrites either, so a child must be told
// which trace it belongs to.
function makeCustomSpan(overrides?: Record<string, unknown>) {
  const now = Date.now();
  return {
    trace_id: generateW3cTraceId(),
    span_id: generateW3cSpanId(),
    parent_span_id: null,
    span_type: "checkout-flow",
    started_at_ms: now - 1000,
    ended_at_ms: null,
    data: {},
    updated_at_ms: now,
    ...overrides,
  };
}

// Retry query because event inserts use ClickHouse async_insert. Span-specific
// durability is asserted without polling in the spans-only regression below.
async function queryAnalyticsUntil(
  body: { query: string, params?: Record<string, string> },
  isDone: (res: { status: number, body: any }) => boolean,
  attempts = 20,
) {
  let queryRes;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await wait(500);
    queryRes = await niceBackendFetch("/api/v1/analytics/query", {
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

it("accepts custom events and stores their enclosing span identity verbatim", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const traceId = generateW3cTraceId();
  const enclosingSpanId = generateW3cSpanId();
  const pageViewSpanId = generateW3cSpanId();
  const now = Date.now();
  const res = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    events: [{
      event_type: "checkout_completed",
      event_at_ms: now - 100,
      data: { cart_size: 3 },
      trace_id: traceId,
      span_id: enclosingSpanId,
      page_view_span_id: pageViewSpanId,
    }],
  });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "accepted_spans": 0,
        "inserted": 1,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT event_type, trace_id, span_id, page_view_span_id FROM events WHERE session_replay_segment_id = {segId:String}",
    params: { segId: sessionReplaySegmentId },
  }, (r) => r.body?.result?.length === 1);

  expect(queryRes?.status).toBe(200);
  const row = (queryRes?.body as any).result[0];
  expect(row.event_type).toBe("checkout_completed");
  // The behavioural core of the W3C model: the ids the SDK sent are the ids that
  // land. No prefix namespace, no server-composed ancestry, no rewriting.
  expect(row.trace_id).toBe(traceId);
  expect(row.span_id).toBe(enclosingSpanId);
  expect(row.page_view_span_id).toBe(pageViewSpanId);
});

it("server-auth telemetry stamps the forwarded client-session context as correlation", async ({ expect }) => {
  // A server span opened with withSpan({ request }) forwards the caller's resolved
  // context (refresh token from the session, replay/segment from the propagation
  // header) as scalars, and the backend stamps them onto the row exactly like a
  // browser event — even though the batch is sent with the secret server key.
  // None of them is ancestry: hierarchy travels only in trace_id/span_id, which
  // the caller supplies from the traceparent it received.
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
  const traceId = generateW3cTraceId();
  const enclosingSpanId = generateW3cSpanId();
  const now = Date.now();

  const res = await uploadTelemetryBatch({
    user_id: userId,
    refresh_token_id: refreshTokenId,
    session_replay_id: sessionReplayId,
    session_replay_segment_id: sessionReplaySegmentId,
    events: [{ event_type: "server_action", event_at_ms: now - 100, data: { ok: true }, trace_id: traceId, span_id: enclosingSpanId }],
  }, { accessType: "server", userAuth: {} });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ inserted: 1, accepted_spans: 0 });

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT event_type, trace_id, span_id, refresh_token_id, session_replay_id, session_replay_segment_id, user_id FROM events WHERE session_replay_segment_id = {segId:String}",
    params: { segId: sessionReplaySegmentId },
  }, (r) => r.body?.result?.length === 1);

  expect(queryRes?.status).toBe(200);
  const row = (queryRes?.body as any).result[0];
  expect(row.event_type).toBe("server_action");
  // Hierarchy is exactly what the caller sent — the session context around it
  // adds correlation columns, never ancestor ids.
  expect(row.trace_id).toBe(traceId);
  expect(row.span_id).toBe(enclosingSpanId);
  // Scalar columns are stamped too, so replay filtering works.
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
  }, { accessType: "server", userAuth: {} });
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
    query: "SELECT user_id, refresh_token_id, session_replay_id FROM events WHERE session_replay_segment_id = {segId:String}",
    params: { segId: serverSegmentId },
  }, (r) => r.body?.result?.length === 1);

  expect(queryRes?.status).toBe(200);
  const row = (queryRes?.body as any).result[0];
  expect(row.user_id).toBe(secondUser.userId);
  expect(row.refresh_token_id).toBe(refreshTokenId);
  // When the forwarded token belongs to a different user there is no valid replay
  // identity to attach, so the replay column stays null rather than leaking
  // another user's recording; the scalar segment id remains for correlation.
  expect(row.session_replay_id).toBeNull();
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

// ---------------------------------------------------------------------------
// W3C identity shape. These are the only structural rules left on the
// hierarchy: with a single scalar parent there is no ancestry PATH to validate,
// so what remains is per-field (32/16 lowercase hex, never all-zero) plus the
// two self-reference rules. Every id below is malformed in exactly one way so a
// regression can be attributed to a specific rule rather than "something threw".
// ---------------------------------------------------------------------------

// The ways a W3C hex id can be wrong. `uppercase` and `nonHex` are deliberately
// the RIGHT length so a passing length check cannot mask a missing character
// check, and `allZero` is the spec's reserved invalid id — the one value that is
// perfectly well-formed hex yet must still be refused.
const MALFORMED_TRACE_IDS = {
  tooShort: "a".repeat(31),
  tooLong: "a".repeat(33),
  uppercase: `A${"a".repeat(31)}`,
  nonHex: `${"a".repeat(31)}z`,
  allZero: "0".repeat(32),
} as const;

const MALFORMED_SPAN_IDS = {
  tooShort: "a".repeat(15),
  tooLong: "a".repeat(17),
  uppercase: `A${"a".repeat(15)}`,
  nonHex: `${"a".repeat(15)}z`,
  allZero: "0".repeat(16),
} as const;

it("rejects trace_ids that are not 32 lowercase hex characters", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  for (const [reason, traceId] of Object.entries(MALFORMED_TRACE_IDS)) {
    const res = await uploadTelemetryBatch({
      session_replay_segment_id: randomUUID(),
      spans: [makeCustomSpan({ trace_id: traceId })],
    });
    expect({ reason, status: res.status, code: res.body?.code }).toEqual({ reason, status: 400, code: "SCHEMA_ERROR" });
  }
});

it("rejects span_ids and parent_span_ids that are not 16 lowercase hex characters", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  for (const [reason, spanId] of Object.entries(MALFORMED_SPAN_IDS)) {
    const badSpanId = await uploadTelemetryBatch({
      session_replay_segment_id: randomUUID(),
      spans: [makeCustomSpan({ span_id: spanId })],
    });
    expect({ field: "span_id", reason, status: badSpanId.status, code: badSpanId.body?.code })
      .toEqual({ field: "span_id", reason, status: 400, code: "SCHEMA_ERROR" });

    const badParentSpanId = await uploadTelemetryBatch({
      session_replay_segment_id: randomUUID(),
      spans: [makeCustomSpan({ parent_span_id: spanId })],
    });
    expect({ field: "parent_span_id", reason, status: badParentSpanId.status, code: badParentSpanId.body?.code })
      .toEqual({ field: "parent_span_id", reason, status: 400, code: "SCHEMA_ERROR" });
  }
});

it("rejects a span that names itself as its own parent", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const spanId = generateW3cSpanId();
  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    spans: [makeCustomSpan({ span_id: spanId, parent_span_id: spanId })],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
});

it("rejects two spans sharing one span_id in the same batch", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  // The one cross-item rule that survives the ancestry deletion: same-id rows
  // would silently collapse into each other in the ReplacingMergeTree, so the
  // second span's data would vanish with a 200 response.
  const traceId = generateW3cTraceId();
  const spanId = generateW3cSpanId();
  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    spans: [
      makeCustomSpan({ trace_id: traceId, span_id: spanId }),
      makeCustomSpan({ trace_id: traceId, span_id: spanId }),
    ],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
});

it("rejects an event that carries only one half of its enclosing span reference", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  // A span id is unique only WITHIN its trace, so `span_id` without `trace_id`
  // does not identify anything, and a `trace_id` with no span says nothing about
  // where in the trace the event happened. Both or neither.
  const traceOnly = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "half_context", event_at_ms: Date.now(), data: {}, trace_id: generateW3cTraceId() }],
  });
  expect(traceOnly.status).toBe(400);
  expect(traceOnly.body?.code).toBe("SCHEMA_ERROR");

  const spanOnly = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "half_context", event_at_ms: Date.now(), data: {}, span_id: generateW3cSpanId() }],
  });
  expect(spanOnly.status).toBe(400);
  expect(spanOnly.body?.code).toBe("SCHEMA_ERROR");
});

it("accepts parent_span_id: null as the trace root and stores identity verbatim", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const traceId = generateW3cTraceId();
  const rootSpanId = generateW3cSpanId();
  const childSpanId = generateW3cSpanId();

  const res = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    spans: [
      makeCustomSpan({ trace_id: traceId, span_id: rootSpanId, parent_span_id: null }),
      makeCustomSpan({ trace_id: traceId, span_id: childSpanId, parent_span_id: rootSpanId }),
    ],
  });
  expect(res.status).toBe(200);
  expect(res.body.accepted_spans).toBe(2);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT span_id, trace_id, parent_span_id FROM spans WHERE session_replay_segment_id = {segId:String}",
    params: { segId: sessionReplaySegmentId },
  }, (r) => r.body?.result?.length === 2);
  expect(queryRes?.status).toBe(200);
  const rows = (queryRes?.body as any).result as { span_id: string, trace_id: string, parent_span_id: string | null }[];

  // The whole point of the W3C model: what the SDK sent is byte-for-byte what is
  // stored. A null parent is preserved as null (that is exactly what
  // trace_roots_mv keys off), and the child's parent reference equals the root's
  // own span_id — no prefix namespace stands between them any more.
  const rootRow = rows.find((row) => row.span_id === rootSpanId);
  expect(rootRow).toEqual({ span_id: rootSpanId, trace_id: traceId, parent_span_id: null });
  const childRow = rows.find((row) => row.span_id === childSpanId);
  expect(childRow).toEqual({ span_id: childSpanId, trace_id: traceId, parent_span_id: rootSpanId });
});

it("round-trips span links into the span_links surface", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const ownerTraceId = generateW3cTraceId();
  const ownerSpanId = generateW3cSpanId();
  // Two links, one same-trace and one cross-trace: `links` is how an ambient
  // context in a DIFFERENT trace than the chosen parent is preserved, so the
  // cross-trace case is the interesting one.
  const sameTraceLink = { trace_id: ownerTraceId, span_id: generateW3cSpanId() };
  const crossTraceLink = { trace_id: generateW3cTraceId(), span_id: generateW3cSpanId() };

  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    spans: [makeCustomSpan({
      trace_id: ownerTraceId,
      span_id: ownerSpanId,
      links: [sameTraceLink, crossTraceLink],
    })],
  });
  expect(res.status).toBe(200);
  expect(res.body.accepted_spans).toBe(1);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT trace_id, owner_span_id, linked_trace_id, linked_span_id, linked_project_id = project_id AS same_project, linked_branch_id = branch_id AS same_branch FROM span_links WHERE owner_span_id = {ownerSpanId:String}",
    params: { ownerSpanId },
  }, (r) => r.body?.result?.length === 2);
  expect(queryRes?.status).toBe(200);
  const linkRows = (queryRes?.body as any).result as { trace_id: string, owner_span_id: string, linked_trace_id: string, linked_span_id: string, same_project: number, same_branch: number }[];

  // Compared by lookup rather than by sorted order: the row order the table
  // returns is not part of the contract, and the ids are random per run.
  // `trace_id` on a link row is the OWNER's trace, not the target's — the table
  // answers "which links does this trace's span declare", so keying by the
  // target's trace would hide every cross-trace link from the trace that made it.
  const linkRowsByLinkedSpanId = new Map(linkRows.map((row) => [row.linked_span_id, row]));
  for (const link of [sameTraceLink, crossTraceLink]) {
    expect(linkRowsByLinkedSpanId.get(link.span_id)).toEqual({
      trace_id: ownerTraceId,
      owner_span_id: ownerSpanId,
      linked_trace_id: link.trace_id,
      linked_span_id: link.span_id,
      same_project: 1,
      same_branch: 1,
    });
  }
});

it("rejects client claims about a span link's target tenancy", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();
  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    spans: [makeCustomSpan({
      links: [{
        trace_id: generateW3cTraceId(),
        span_id: generateW3cSpanId(),
        linked_project_id: "another-project",
        linked_branch_id: "main",
      }],
    })],
  });
  expect(res.status).toBe(400);
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
    events: [{ event_type: "checkout_completed", event_at_ms: Date.now(), data: { pad: "x".repeat(CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES + 1) } }],
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
    events: [{ event_type: "checkout_completed", event_at_ms: Date.now(), data: { pad: "é".repeat(Math.ceil(CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES / 2) + 1) } }],
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

it("accepts a $page-view trace with nested autocapture and custom spans, all identity verbatim", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  // One trace rooted at the page view — a page view IS a root activity, so it
  // carries parent_span_id: null and everything on the page hangs beneath it.
  const traceId = generateW3cTraceId();
  const pageViewSpanId = generateW3cSpanId();
  const awaySpanId = generateW3cSpanId();
  const customSpanId = generateW3cSpanId();
  const now = Date.now();

  const res = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    spans: [
      makeCustomSpan({ trace_id: traceId, span_id: pageViewSpanId, parent_span_id: null, span_type: "$page-view", data: { path: "/exam", entry_type: "initial" } }),
      makeCustomSpan({ trace_id: traceId, span_id: awaySpanId, parent_span_id: pageViewSpanId, span_type: "$away", page_view_span_id: pageViewSpanId, data: { reasons: ["tab-hidden"] } }),
      makeCustomSpan({ trace_id: traceId, span_id: customSpanId, parent_span_id: pageViewSpanId, page_view_span_id: pageViewSpanId }),
    ],
    events: [{
      event_type: "$paste",
      event_at_ms: now - 100,
      data: { length: 12, same_page_origin: 0 },
      trace_id: traceId,
      span_id: pageViewSpanId,
      page_view_span_id: pageViewSpanId,
    }],
  });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ inserted: 1, accepted_spans: 3 });

  const spanQueryRes = await queryAnalyticsUntil({
    query: "SELECT span_id, span_type, trace_id, parent_span_id, page_view_span_id FROM spans WHERE session_replay_segment_id = {segId:String} ORDER BY span_id",
    params: { segId: sessionReplaySegmentId },
  }, (r) => r.body?.result?.length === 3);
  expect(spanQueryRes?.status).toBe(200);
  const spanRows = (spanQueryRes?.body as any).result as { span_id: string, span_type: string, trace_id: string, parent_span_id: string | null, page_view_span_id: string | null }[];

  // Every row shares one trace and keeps its exact ids. A `$page-view` span does
  // NOT name itself in page_view_span_id — it IS the page.
  expect(spanRows.find((row) => row.span_id === pageViewSpanId)).toEqual({
    span_id: pageViewSpanId, span_type: "$page-view", trace_id: traceId, parent_span_id: null, page_view_span_id: null,
  });
  expect(spanRows.find((row) => row.span_id === awaySpanId)).toEqual({
    span_id: awaySpanId, span_type: "$away", trace_id: traceId, parent_span_id: pageViewSpanId, page_view_span_id: pageViewSpanId,
  });
  expect(spanRows.find((row) => row.span_id === customSpanId)).toEqual({
    span_id: customSpanId, span_type: "checkout-flow", trace_id: traceId, parent_span_id: pageViewSpanId, page_view_span_id: pageViewSpanId,
  });

  // Events join the same trace by naming their enclosing span, and additionally
  // carry the page as a correlation label.
  const eventQueryRes = await queryAnalyticsUntil({
    query: "SELECT event_type, trace_id, span_id, page_view_span_id FROM events WHERE session_replay_segment_id = {segId:String}",
    params: { segId: sessionReplaySegmentId },
  }, (r) => r.body?.result?.length === 1);
  expect(eventQueryRes?.status).toBe(200);
  expect((eventQueryRes?.body as any).result[0]).toEqual({
    event_type: "$paste", trace_id: traceId, span_id: pageViewSpanId, page_view_span_id: pageViewSpanId,
  });
});

it("rejects a span naming itself as its own page_view_span_id", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  // The last surviving page-view rule. The old "a $page-view must not carry
  // parent ancestry" checks are gone: under W3C a page view can legitimately be
  // parented (e.g. a client-side navigation inside an enclosing custom span), so
  // only genuine self-reference is still nonsense.
  const spanId = generateW3cSpanId();
  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    spans: [makeCustomSpan({ span_id: spanId, span_type: "$away", page_view_span_id: spanId })],
  });
  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
  expect(res.body?.error).toContain("must not name itself as its page_view_span_id");
});

it("rejects invalid page_view_span_id values on events and spans", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  // page_view_span_id is a W3C span id like any other, so a uuid — the shape it
  // used to have — must now be rejected.
  const badEvent = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "$click", event_at_ms: Date.now(), data: {}, page_view_span_id: randomUUID() }],
  });
  expect(badEvent.status).toBe(400);
  expect(badEvent.body?.code).toBe("SCHEMA_ERROR");
  expect(badEvent.body?.error).toContain("page_view_span_id");

  const badSpan = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    spans: [makeCustomSpan({ page_view_span_id: MALFORMED_SPAN_IDS.allZero })],
  });
  expect(badSpan.status).toBe(400);
  expect(badSpan.body?.code).toBe("SCHEMA_ERROR");
  expect(badSpan.body?.error).toContain("page_view_span_id");
});

it("applies one bounded object-data contract to legacy and current event types", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const oversizedNew = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "$form-submit", event_at_ms: Date.now(), data: { pad: "x".repeat(64_001) } }],
  });
  expect(oversizedNew.status).toBe(400);
  expect(oversizedNew.body?.error).toContain("Event data must be a JSON object");

  const oversizedLegacy = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "$click", event_at_ms: Date.now(), data: { pad: "x".repeat(64_001) } }],
  });
  expect(oversizedLegacy.status).toBe(400);
  expect(oversizedLegacy.body?.error).toContain("Event data must be a JSON object");

  const releasedTrackerShape = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{
      event_type: "$click",
      event_at_ms: Date.now(),
      data: { path: "/checkout", selector: "button[data-testid=\"submit\"]", x: 12, y: 24 },
    }],
  });
  expect(releasedTrackerShape.status).toBe(200);
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
  const traceId = generateW3cTraceId();
  const spanId = generateW3cSpanId();
  const now = Date.now();
  const res = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    spans: [{
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: null,
      span_type: "checkout-flow",
      started_at_ms: now - 1000,
      ended_at_ms: null,
      data: {},
      updated_at_ms: now,
    }],
  });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "accepted_spans": 1,
        "inserted": 0,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // A successful response is the durability boundary for spans: this query must
  // succeed immediately, without waiting for an in-memory background task.
  // Looking the row up by the id the SDK minted is itself part of the contract —
  // there is no server-side prefix to reconstruct.
  const queryRes = await niceBackendFetch("/api/v1/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "SELECT span_id, span_type, ended_at, trace_id, parent_span_id, user_id, session_replay_segment_id FROM spans WHERE span_id = {id:String}",
      params: { id: spanId },
    },
  });

  expect(queryRes.status).toBe(200);
  const rows = (queryRes.body as any).result;
  expect(rows).toHaveLength(1);
  expect(rows[0].span_id).toBe(spanId);
  expect(rows[0].span_type).toBe("checkout-flow");
  // The span is still open.
  expect(rows[0].ended_at).toBeNull();
  expect(rows[0].trace_id).toBe(traceId);
  // A trace root: sessions/replays are correlation columns, never ancestors.
  expect(rows[0].parent_span_id).toBeNull();
  expect(rows[0].user_id).toBe(userId);
  expect(rows[0].session_replay_segment_id).toBe(sessionReplaySegmentId);
});

it("collapses open→closed span re-writes to the ended row", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  // Span identity is (trace_id, span_id) — that pair is the ReplacingMergeTree's
  // key — so a re-write of the same span must repeat BOTH ids, not just span_id.
  const traceId = generateW3cTraceId();
  const spanId = generateW3cSpanId();
  const now = Date.now();
  const startedAtMs = now - 10_000;
  const endedAtMs = now - 2000;
  const openUpdatedAtMs = now - 9000;
  const closedUpdatedAtMs = now - 1000;

  const openRes = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    spans: [makeCustomSpan({ trace_id: traceId, span_id: spanId, started_at_ms: startedAtMs, ended_at_ms: null, updated_at_ms: openUpdatedAtMs })],
  });
  expect(openRes.status).toBe(200);

  const openQueryRes = await queryAnalyticsUntil({
    query: "SELECT span_id, ended_at FROM spans WHERE span_id = {id:String}",
    params: { id: spanId },
  }, (r) => r.body?.result?.length === 1);
  expect(openQueryRes?.status).toBe(200);
  expect((openQueryRes?.body as any).result[0].ended_at).toBeNull();

  const closedRes = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    spans: [makeCustomSpan({ trace_id: traceId, span_id: spanId, started_at_ms: startedAtMs, ended_at_ms: endedAtMs, updated_at_ms: closedUpdatedAtMs })],
  });
  expect(closedRes.status).toBe(200);

  // The view reads FINAL, so the two versions collapse to the ended row.
  const closedQueryRes = await queryAnalyticsUntil({
    query: "SELECT span_id, ended_at FROM spans WHERE span_id = {id:String}",
    params: { id: spanId },
  }, (r) => r.body?.result?.length === 1 && r.body.result[0].ended_at != null);
  expect(closedQueryRes?.status).toBe(200);
  const rows = (closedQueryRes?.body as any).result;
  expect(rows).toHaveLength(1);
  expect(rows[0].ended_at).not.toBeNull();
});

it("keeps the ended row when an open re-write arrives with an older version (out-of-order)", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  // Both re-writes must repeat the same (trace_id, span_id) pair — see the
  // collapse test above for why span_id alone is not the span's identity.
  const traceId = generateW3cTraceId();
  const spanId = generateW3cSpanId();
  const sentinelSpanId = generateW3cSpanId();
  const now = Date.now();
  const startedAtMs = now - 10_000;
  const endedAtMs = now - 2000;
  const openUpdatedAtMs = now - 9000;
  const closedUpdatedAtMs = now - 1000;

  // The END row arrives first, carrying the LATER version…
  const closedRes = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    spans: [makeCustomSpan({ trace_id: traceId, span_id: spanId, started_at_ms: startedAtMs, ended_at_ms: endedAtMs, updated_at_ms: closedUpdatedAtMs })],
  });
  expect(closedRes.status).toBe(200);

  const closedQueryRes = await queryAnalyticsUntil({
    query: "SELECT span_id, ended_at FROM spans WHERE span_id = {id:String}",
    params: { id: spanId },
  }, (r) => r.body?.result?.length === 1);
  expect(closedQueryRes?.status).toBe(200);
  expect((closedQueryRes?.body as any).result[0].ended_at).not.toBeNull();

  // …then a stale OPEN row with the EARLIER version arrives. The sentinel span
  // rides in the same batch (same ClickHouse insert), so once it is visible the
  // stale open row has landed too.
  const staleOpenRes = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    spans: [
      makeCustomSpan({ trace_id: traceId, span_id: spanId, started_at_ms: startedAtMs, ended_at_ms: null, updated_at_ms: openUpdatedAtMs }),
      makeCustomSpan({ trace_id: traceId, span_id: sentinelSpanId }),
    ],
  });
  expect(staleOpenRes.status).toBe(200);

  const sentinelQueryRes = await queryAnalyticsUntil({
    query: "SELECT span_id FROM spans WHERE span_id = {id:String}",
    params: { id: sentinelSpanId },
  }, (r) => r.body?.result?.length === 1);
  expect(sentinelQueryRes?.status).toBe(200);

  // The ended row still wins: version (updated_at_ms) decides, not insert order.
  const finalQueryRes = await queryAnalyticsUntil({
    query: "SELECT span_id, ended_at FROM spans WHERE span_id = {id:String}",
    params: { id: spanId },
  }, (r) => r.body?.result?.length === 1);
  expect(finalQueryRes?.status).toBe(200);
  const rows = (finalQueryRes?.body as any).result;
  expect(rows).toHaveLength(1);
  expect(rows[0].ended_at).not.toBeNull();
});

it("accepts server-key batches with explicit user_id and no span correlation", async ({ expect }) => {
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
      "body": {
        "accepted_spans": 0,
        "inserted": 1,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT user_id, trace_id, span_id FROM events WHERE event_type = {eventType:String}",
    params: { eventType },
  }, (r) => r.body?.result?.length === 1);

  expect(queryRes?.status).toBe(200);
  const row = (queryRes?.body as any).result[0];
  expect(row.user_id).toBe(userId);
  // The batch declared no enclosing span, and the server never invents one, so
  // the event is uncorrelated to any trace.
  expect(row.trace_id).toBeNull();
  expect(row.span_id).toBeNull();
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

it("accepts server-key spans as trace roots", async ({ expect }) => {
  await setupAnalyticsProject();
  const { userId } = await Auth.Otp.signIn();
  backendContext.set({ userAuth: null });

  const spanId = generateW3cSpanId();
  const res = await uploadTelemetryBatch({
    user_id: userId,
    spans: [makeCustomSpan({ span_id: spanId })],
  }, { accessType: "server" });
  expect(res.status).toBe(200);
  expect(res.body.inserted).toBe(0);
  expect(res.body.accepted_spans).toBe(1);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT span_id, span_type, parent_span_id, user_id FROM spans WHERE span_id = {id:String}",
    params: { id: spanId },
  }, (r) => r.body?.result?.length === 1);

  expect(queryRes?.status).toBe(200);
  const rows = (queryRes?.body as any).result;
  expect(rows).toHaveLength(1);
  expect(rows[0].span_type).toBe("checkout-flow");
  expect(rows[0].user_id).toBe(userId);
  // The SDK sent parent_span_id: null, so this span IS its trace's root — which
  // is also what trace_roots_mv keys off. The refresh token, whether present or
  // not, is never an ancestor.
  expect(rows[0].parent_span_id).toBeNull();
});

it("stores nested library operations by name and keeps their instrumentation scope", async ({ expect }) => {
  await setupAnalyticsProject();
  backendContext.set({ userAuth: null });

  const traceId = generateW3cTraceId();
  const parentLibSpanId = generateW3cSpanId();
  const childLibSpanId = generateW3cSpanId();
  const now = Date.now();
  const res = await uploadTelemetryBatch({
    spans: [
      // The child ends BEFORE its parent (Prisma engine:query inside
      // client:operation) — the real emission order of the SDK's library-span
      // bridge, which only ships spans at end().
      makeCustomSpan({ trace_id: traceId, span_id: childLibSpanId, parent_span_id: parentLibSpanId, span_type: "prisma:client:db_query", scope_name: "prisma", started_at_ms: now - 800, ended_at_ms: now - 300, data: { name: "prisma:client:db_query", category: "db" } }),
      makeCustomSpan({ trace_id: traceId, span_id: parentLibSpanId, parent_span_id: null, span_type: "prisma:client:operation", scope_name: "prisma", started_at_ms: now - 1000, ended_at_ms: now - 100, data: { name: "prisma:client:operation", category: "db" } }),
    ],
  }, { accessType: "server" });
  expect(res.status).toBe(200);
  expect(res.body.accepted_spans).toBe(2);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT span_id, span_type, scope_name, trace_id, parent_span_id FROM spans WHERE span_id IN ({childId:String}, {parentId:String}) ORDER BY span_id = {childId:String}",
    params: { childId: childLibSpanId, parentId: parentLibSpanId },
  }, (r) => r.body?.result?.length === 2);
  expect(queryRes?.status).toBe(200);
  const rows = (queryRes?.body as any).result as { span_id: string, span_type: string, scope_name: string, trace_id: string, parent_span_id: string | null }[];
  expect(rows[0]).toEqual({ span_id: parentLibSpanId, span_type: "prisma:client:operation", scope_name: "prisma", trace_id: traceId, parent_span_id: null });
  // The child's parent reference must equal the parent row's own span_id. This
  // used to require both spans landing in the same prefix namespace; now it is
  // simply the id the SDK sent, which is the whole point of dropping prefixes.
  expect(rows[1]).toEqual({ span_id: childLibSpanId, span_type: "prisma:client:db_query", scope_name: "prisma", trace_id: traceId, parent_span_id: parentLibSpanId });
});

it("does not debit span quota for server-authenticated library operation spans", async ({ expect }) => {
  await setupAnalyticsProject();
  backendContext.set({ userAuth: null });

  const res = await uploadTelemetryBatch({
    spans: [makeCustomSpan({ span_type: "prisma:client:db_query", scope_name: "prisma", data: { name: "prisma:client:db_query", category: "db" } })],
  }, { accessType: "server" });
  expect(res.status).toBe(200);
  // Acceptance is the observable contract here; the zero-billing itself is
  // covered by the span_writes_mv integration test (`scope_name IS NULL`)
  // and the route's billableSpanCount filter.
  expect(res.body.accepted_spans).toBe(1);
});

it("accepts internal backend spans without consuming customer telemetry quota", async ({ expect }) => {
  const originalQuantity = await getItemQuantity(INTERNAL_PROJECT_OWNER_TEAM_ID, ITEM_IDS.analyticsSpans);
  try {
    await setItemQuantity(INTERNAL_PROJECT_OWNER_TEAM_ID, ITEM_IDS.analyticsSpans, 0);
    const res = await withInternalProject(async () => await uploadTelemetryBatch({
      spans: [makeCustomSpan({
        span_type: "hexclave.api.request",
        data: { method: "GET", path: "/api/v1/users/me" },
      })],
    }, { accessType: "server" }));

    expect(res.status).toBe(200);
    expect(res.body.accepted_spans).toBe(1);
    expect(await getItemQuantity(INTERNAL_PROJECT_OWNER_TEAM_ID, ITEM_IDS.analyticsSpans)).toBe(0);
  } finally {
    await setItemQuantity(INTERNAL_PROJECT_OWNER_TEAM_ID, ITEM_IDS.analyticsSpans, originalQuantity);
  }
});

it("rejects instrumentation-scoped spans with client auth (a page must not forge server work)", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const res = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    spans: [makeCustomSpan({ span_type: "prisma:client:db_query", scope_name: "prisma", data: { name: "prisma:client:db_query", category: "db" } })],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
  expect(res.body?.error).toContain("authenticated SDK tier is not allowed");
});

it("rejects browser-only interaction signals with server auth", async ({ expect }) => {
  await setupAnalyticsProject();
  backendContext.set({ userAuth: null });

  const res = await uploadTelemetryBatch({
    events: [{ event_type: "$click", event_at_ms: Date.now(), data: {} }],
  }, { accessType: "server" });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("SCHEMA_ERROR");
  expect(res.body?.error).toContain("authenticated SDK tier is not allowed");
});

it("accepts a gzipped binary body containing custom events and spans", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const now = Date.now();
  const payload = {
    ...DEFAULT_TELEMETRY_BATCH_FIELDS,
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
      "body": {
        "accepted_spans": 1,
        "inserted": 1,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

// $log events (SDK logger) and $error events (global error capture)
// ---------------------------------------------------------------------------

it("accepts $log events with message/level and stamps producer/runtime server-side", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const now = Date.now();
  const res = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    events: [{
      event_type: "$log",
      event_at_ms: now - 100,
      data: { request_id: "req_123" },
      message: "checkout failed for cart",
      level: "warn",
    }],
  });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "accepted_spans": 0,
        "inserted": 1,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT event_type, message, level, producer, runtime, service_namespace, service_name, service_version, deployment_environment_name, JSONExtractString(resource_attributes, 'suite') AS resource_suite FROM logs WHERE session_replay_segment_id = {segId:String}",
    params: { segId: sessionReplaySegmentId },
  }, (r) => Array.isArray(r.body.result) && r.body.result.length === 1);
  // producer/runtime come from the route, never from the client: client auth
  // is the browser tracker, hence runtime='browser'.
  expect(queryRes?.body.result[0]).toMatchInlineSnapshot(`
    {
      "deployment_environment_name": "test",
      "event_type": "$log",
      "level": "warn",
      "message": "checkout failed for cart",
      "producer": "sdk",
      "resource_suite": "analytics-events-batch",
      "runtime": "browser",
      "service_name": "test-client",
      "service_namespace": "e2e",
      "service_version": "test",
    }
  `);

  const isolationRes = await niceBackendFetch("/api/v1/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: "SELECT count() AS product_event_count FROM events WHERE session_replay_segment_id = {segId:String}",
      params: { segId: sessionReplaySegmentId },
    },
  });
  expect(Number(isolationRes.body.result[0].product_event_count)).toBe(0);
});

it("rejects $log events without message/level and non-log events with them", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();
  const now = Date.now();

  const missingFields = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "$log", event_at_ms: now, data: {} }],
  });
  expect(missingFields.status).toBe(400);
  expect(JSON.stringify(missingFields.body)).toContain("message/level are required for $log events");

  const nonLogWithMessage = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "$click", event_at_ms: now, data: {}, message: "nope", level: "info" }],
  });
  expect(nonLogWithMessage.status).toBe(400);
});

it("rejects the retired body/severity log fields and levels outside the enum", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();
  const now = Date.now();

  // Pre-rename SDK payloads must fail loudly (unknown properties), not be
  // silently accepted with empty message/level.
  const legacyFields = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{
      event_type: "$log",
      event_at_ms: now,
      data: {},
      body: "checkout failed for cart",
      severity_number: 13,
      severity_text: "WARN",
    }],
  });
  expect(legacyFields.status).toBe(400);

  const invalidLevel = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "$log", event_at_ms: now, data: {}, message: "hello", level: "critical" }],
  });
  expect(invalidLevel.status).toBe(400);

  // Severity synonyms from other logging vocabularies are not silently mapped.
  const upperCaseLevel = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    events: [{ event_type: "$log", event_at_ms: now, data: {}, message: "hello", level: "WARN" }],
  });
  expect(upperCaseLevel.status).toBe(400);
});

it("accepts $error events", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const now = Date.now();
  const res = await uploadTelemetryBatch({
    session_replay_segment_id: sessionReplaySegmentId,
    events: [{
      event_type: "$error",
      event_at_ms: now - 50,
      data: {
        message: "boom",
        name: "TypeError",
        stack: "TypeError: boom\n    at explode (app.js:1:1)",
        mechanism: "global.onerror",
        fingerprint: "abc123",
      },
    }],
  });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "accepted_spans": 0,
        "inserted": 1,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const queryRes = await queryAnalyticsUntil({
    query: "SELECT event_type, data.message AS message FROM errors WHERE session_replay_segment_id = {segId:String}",
    params: { segId: sessionReplaySegmentId },
  }, (response) => Array.isArray(response.body.result) && response.body.result.length === 1);
  expect(queryRes?.body.result[0]).toEqual({ event_type: "$error", message: "boom" });
});

it("requires schema version 3 and an explicit telemetry resource", async ({ expect }) => {
  await setupAnalyticsProject();
  await Auth.Otp.signIn();
  const now = Date.now();

  const v3 = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    schema_version: 3,
    events: [{ event_type: "$click", event_at_ms: now, data: {} }],
  });
  expect(v3.status).toBe(200);

  // v2 was the full-ancestry wire (parent_span_ids / http_client_span_id). The
  // feature is unreleased, so v3 REPLACES it outright: accepting a v2 body would
  // mean silently ignoring hierarchy the sender still believed it was sending.
  const v2 = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    schema_version: 2,
    events: [{ event_type: "$click", event_at_ms: now, data: {} }],
  });
  expect(v2.status).toBe(400);

  const v1 = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    schema_version: 1,
    events: [{ event_type: "$click", event_at_ms: now, data: {} }],
  });
  expect(v1.status).toBe(400);

  const missingResource = await uploadTelemetryBatch({
    session_replay_segment_id: randomUUID(),
    resource: null,
    events: [{ event_type: "$click", event_at_ms: now, data: {} }],
  });
  expect(missingResource.status).toBe(400);
});
