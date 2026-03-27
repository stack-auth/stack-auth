import { randomUUID } from "node:crypto";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { it } from "../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";

async function uploadEventBatch(options: {
  accessType?: "client" | "server" | "admin",
  sessionReplayId?: string,
  sessionReplaySegmentId?: string,
  batchId: string,
  sentAtMs: number,
  events: {
    event_type: string,
    event_at_ms: number,
    data: Record<string, unknown>,
    user_id?: string,
    team_id?: string,
    session_replay_id?: string,
    session_replay_segment_id?: string,
  }[],
}) {
  return await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: options.accessType ?? "client",
    body: {
      session_replay_id: options.sessionReplayId,
      session_replay_segment_id: options.sessionReplaySegmentId,
      batch_id: options.batchId,
      sent_at_ms: options.sentAtMs,
      events: options.events,
    },
  });
}

async function queryEventsByTypeWithRetry(eventType: string) {
  let response = await niceBackendFetch("/api/v1/internal/analytics/query", {
    method: "POST",
    accessType: "admin",
    body: {
      query: `
        SELECT event_type, user_id, team_id, session_replay_id, session_replay_segment_id
        FROM events
        WHERE event_type = {event_type:String}
        ORDER BY event_at DESC
        LIMIT 5
      `,
      params: { event_type: eventType },
    },
  });

  for (let attempt = 0; attempt < 15; attempt++) {
    const results = Array.isArray(response.body?.result) ? response.body.result : [];
    if (response.status !== 200 || results.length > 0) {
      return response;
    }
    await wait(500);
    response = await niceBackendFetch("/api/v1/internal/analytics/query", {
      method: "POST",
      accessType: "admin",
      body: {
        query: `
          SELECT event_type, user_id, team_id, session_replay_id, session_replay_segment_id
          FROM events
          WHERE event_type = {event_type:String}
          ORDER BY event_at DESC
          LIMIT 5
        `,
        params: { event_type: eventType },
      },
    });
  }

  return response;
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
      "body": { "inserted": 2 },
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
      "body": { "inserted": 1 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("accepts valid $tab-in and $tab-out events", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const now = Date.now();
  const res = await uploadEventBatch({
    sessionReplaySegmentId,
    batchId: randomUUID(),
    sentAtMs: now,
    events: [
      {
        event_type: "$tab-out",
        event_at_ms: now - 100,
        data: {
          url: "https://example.com/checkout",
          path: "/checkout",
          title: "Checkout",
          visibility_state: "hidden",
          hidden: true,
          viewport_width: 1920,
          viewport_height: 1080,
          screen_width: 1920,
          screen_height: 1080,
        },
      },
      {
        event_type: "$tab-in",
        event_at_ms: now - 50,
        data: {
          url: "https://example.com/checkout",
          path: "/checkout",
          title: "Checkout",
          visibility_state: "visible",
          hidden: false,
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
      "body": { "inserted": 2 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  let queryRes;
  for (let attempt = 0; attempt < 15; attempt++) {
    await wait(500);
    queryRes = await niceBackendFetch("/api/v1/internal/analytics/query", {
      method: "POST",
      accessType: "admin",
      body: {
        query: `
          SELECT event_type, session_replay_segment_id
          FROM events
          WHERE session_replay_segment_id = {segId:String}
            AND event_type IN ('$tab-in', '$tab-out')
          ORDER BY event_at ASC
        `,
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
            "event_type": "$tab-out",
            "session_replay_segment_id": "<stripped UUID>",
          },
          {
            "event_type": "$tab-in",
            "session_replay_segment_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("accepts extended browser lifecycle and interaction events", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const now = Date.now();
  const res = await uploadEventBatch({
    sessionReplaySegmentId,
    batchId: randomUUID(),
    sentAtMs: now,
    events: [
      {
        event_type: "$window-blur",
        event_at_ms: now - 160,
        data: {
          path: "/checkout",
          url: "https://example.com/checkout",
          title: "Checkout",
          visibility_state: "visible",
          hidden: false,
          has_focus: false,
        },
      },
      {
        event_type: "$window-focus",
        event_at_ms: now - 140,
        data: {
          path: "/checkout",
          url: "https://example.com/checkout",
          title: "Checkout",
          visibility_state: "visible",
          hidden: false,
          has_focus: true,
        },
      },
      {
        event_type: "$submit",
        event_at_ms: now - 120,
        data: {
          action: "https://example.com/checkout",
          method: "post",
          field_count: 3,
          tag_name: "form",
          selector: "form.checkout",
          submitter_tag_name: "button",
          submitter_selector: "form.checkout > button",
          submitter_text: "Pay now",
          path: "/checkout",
          url: "https://example.com/checkout",
          title: "Checkout",
        },
      },
      {
        event_type: "$scroll-depth",
        event_at_ms: now - 100,
        data: {
          depth_percent: 50,
          actual_depth_percent: 63,
          step_percent: 25,
          path: "/checkout",
          url: "https://example.com/checkout",
          title: "Checkout",
        },
      },
      {
        event_type: "$rage-click",
        event_at_ms: now - 80,
        data: {
          click_count: 3,
          radius_px: 24,
          tag_name: "button",
          selector: "form.checkout > button",
          text: "Pay now",
          x: 100,
          y: 200,
          page_x: 100,
          page_y: 500,
          viewport_width: 1920,
          viewport_height: 1080,
        },
      },
      {
        event_type: "$copy",
        event_at_ms: now - 60,
        data: {
          clipboard_types: ["text/plain"],
          has_selection: true,
          tag_name: "input",
          selector: "form.checkout > input.email",
          path: "/checkout",
          url: "https://example.com/checkout",
          title: "Checkout",
        },
      },
      {
        event_type: "$paste",
        event_at_ms: now - 40,
        data: {
          clipboard_types: ["text/plain", "text/html"],
          tag_name: "input",
          selector: "form.checkout > input.promo",
          path: "/checkout",
          url: "https://example.com/checkout",
          title: "Checkout",
        },
      },
      {
        event_type: "$error",
        event_at_ms: now - 20,
        data: {
          source: "window-error",
          error_name: "Error",
          error_message: "Boom",
          error_kind: "Error",
          filename: "app.js",
          lineno: 10,
          colno: 3,
          path: "/checkout",
          url: "https://example.com/checkout",
          title: "Checkout",
        },
      },
    ],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "inserted": 8 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  let queryRes;
  for (let attempt = 0; attempt < 15; attempt++) {
    await wait(500);
    queryRes = await niceBackendFetch("/api/v1/internal/analytics/query", {
      method: "POST",
      accessType: "admin",
      body: {
        query: `
          SELECT event_type, session_replay_segment_id
          FROM events
          WHERE session_replay_segment_id = {segId:String}
            AND event_type IN ('$window-focus', '$window-blur', '$submit', '$scroll-depth', '$rage-click', '$copy', '$paste', '$error')
          ORDER BY event_at ASC
        `,
        params: { segId: sessionReplaySegmentId },
      },
    });
    if (queryRes.status === 200 && queryRes.body?.result?.length === 8) {
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
            "event_type": "$window-blur",
            "session_replay_segment_id": "<stripped UUID>",
          },
          {
            "event_type": "$window-focus",
            "session_replay_segment_id": "<stripped UUID>",
          },
          {
            "event_type": "$submit",
            "session_replay_segment_id": "<stripped UUID>",
          },
          {
            "event_type": "$scroll-depth",
            "session_replay_segment_id": "<stripped UUID>",
          },
          {
            "event_type": "$rage-click",
            "session_replay_segment_id": "<stripped UUID>",
          },
          {
            "event_type": "$copy",
            "session_replay_segment_id": "<stripped UUID>",
          },
          {
            "event_type": "$paste",
            "session_replay_segment_id": "<stripped UUID>",
          },
          {
            "event_type": "$error",
            "session_replay_segment_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("accepts custom events from client auth and makes them queryable", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  const { userId } = await Auth.Otp.signIn();

  const eventType = `checkout.completed.${randomUUID()}`;
  const res = await uploadEventBatch({
    batchId: randomUUID(),
    sentAtMs: Date.now(),
    events: [{
      event_type: eventType,
      event_at_ms: Date.now(),
      data: {
        amount: 4200,
        currency: "usd",
      },
    }],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "inserted": 1 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const queryRes = await queryEventsByTypeWithRetry(eventType);
  expect(queryRes).toMatchObject({
    status: 200,
    body: {
      result: [{
        event_type: eventType,
        user_id: userId,
        team_id: null,
        session_replay_segment_id: null,
      }],
    },
  });
});

it("accepts project-scoped custom events from server auth", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });

  const eventType = `billing.invoice.created.${randomUUID()}`;
  const res = await uploadEventBatch({
    accessType: "server",
    batchId: randomUUID(),
    sentAtMs: Date.now(),
    events: [{
      event_type: eventType,
      event_at_ms: Date.now(),
      data: {
        invoice_id: randomUUID(),
      },
    }],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "inserted": 1 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const queryRes = await queryEventsByTypeWithRetry(eventType);
  expect(queryRes).toMatchObject({
    status: 200,
    body: {
      result: [{
        event_type: eventType,
        user_id: null,
        team_id: null,
        session_replay_segment_id: null,
      }],
    },
  });
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
      "body": { "inserted": 1 },
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
              - body.events field must have at least 1 items
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/analytics/events/batch:
            - body.events field must have at least 1 items
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

it("rejects custom event types that use the reserved $ prefix", async ({ expect }) => {
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
      events: [{ event_type: "$checkout.completed", event_at_ms: Date.now(), data: {} }],
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
              - event_type must be "$page-view", "$click", "$tab-in", "$tab-out", "$window-focus", "$window-blur", "$submit", "$scroll-depth", "$rage-click", "$copy", "$paste", "$error", "$request", or a custom event name that does not start with "$" and only contains letters, numbers, ".", "_", ":", or "-"
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/analytics/events/batch:
            - event_type must be "$page-view", "$click", "$tab-in", "$tab-out", "$window-focus", "$window-blur", "$submit", "$scroll-depth", "$rage-click", "$copy", "$paste", "$error", "$request", or a custom event name that does not start with "$" and only contains letters, numbers, ".", "_", ":", or "-"
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects client attempts to override user_id or team_id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await uploadEventBatch({
    batchId: randomUUID(),
    sentAtMs: Date.now(),
    events: [{
      event_type: "checkout.completed",
      event_at_ms: Date.now(),
      data: {},
      user_id: randomUUID(),
    }],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Client analytics events cannot override user_id or team_id",
      "headers": Headers { <some fields may have been hidden> },
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
      "body": { "inserted": 2 },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Retry query because async inserts may have a flush delay
  let queryRes;
  for (let attempt = 0; attempt < 15; attempt++) {
    await wait(500);
    queryRes = await niceBackendFetch("/api/v1/internal/analytics/query", {
      method: "POST",
      accessType: "admin",
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

it("stores explicit session replay linkage and lets event-level segment ids override batch defaults", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const now = Date.now();
  const browserSessionId = randomUUID();
  const uploadReplayRes = await niceBackendFetch("/api/v1/session-replays/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: browserSessionId,
      session_replay_segment_id: randomUUID(),
      batch_id: randomUUID(),
      started_at_ms: now - 200,
      sent_at_ms: now - 100,
      events: [{ timestamp: now - 150 }],
    },
  });
  expect(uploadReplayRes.status).toBe(200);

  const sessionReplayId = uploadReplayRes.body?.session_replay_id;
  expect(typeof sessionReplayId).toBe("string");
  if (typeof sessionReplayId !== "string") {
    throw new Error("Expected session replay upload response to include a session_replay_id.");
  }

  const batchSessionReplaySegmentId = randomUUID();
  const eventSessionReplaySegmentId = randomUUID();
  const eventType = `checkout.explicit-link.${randomUUID()}`;
  const uploadEventRes = await uploadEventBatch({
    sessionReplayId,
    sessionReplaySegmentId: batchSessionReplaySegmentId,
    batchId: randomUUID(),
    sentAtMs: now,
    events: [{
      event_type: eventType,
      event_at_ms: now,
      data: { source: "explicit-link" },
      session_replay_segment_id: eventSessionReplaySegmentId,
    }],
  });
  expect(uploadEventRes.status).toBe(200);

  const queryRes = await queryEventsByTypeWithRetry(eventType);
  expect(queryRes.body?.result?.[0]).toMatchObject({
    event_type: eventType,
    session_replay_id: sessionReplayId,
    session_replay_segment_id: eventSessionReplaySegmentId,
  });
});

it("rejects unknown session_replay_id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const unknownSessionReplayId = randomUUID();
  const res = await uploadEventBatch({
    sessionReplayId: unknownSessionReplayId,
    sessionReplaySegmentId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: Date.now(),
    events: [{
      event_type: "checkout.unknown-session-replay-id",
      event_at_ms: Date.now(),
      data: {},
    }],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Unknown session_replay_id: <stripped UUID>",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
