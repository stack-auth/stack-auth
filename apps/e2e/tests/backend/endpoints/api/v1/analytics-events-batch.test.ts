import { randomUUID } from "node:crypto";
import { it } from "../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";

async function uploadEventBatch(options: {
  browserSessionId: string,
  batchId: string,
  sentAtMs: number,
  events: { event_type: string, event_at_ms: number, data: unknown }[],
  tabId?: string,
}) {
  return await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: options.browserSessionId,
      tab_id: options.tabId ?? randomUUID(),
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
      browser_session_id: randomUUID(),
      tab_id: randomUUID(),
      batch_id: randomUUID(),
      sent_at_ms: Date.now(),
      events: [{ event_type: "$page-view", event_at_ms: Date.now(), data: { url: "https://example.com" } }],
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("returns 200 no-op when analytics is not enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  // Analytics is disabled by default - do NOT call Project.updateConfig
  await Auth.Otp.signIn();

  const res = await uploadEventBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: Date.now(),
    events: [{ event_type: "$page-view", event_at_ms: Date.now(), data: { url: "https://example.com" } }],
  });

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: "ok", event_count: 0 });
});

it("accepts a valid event batch and returns event_count", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const now = Date.now();

  const res = await uploadEventBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: now + 500,
    events: [
      { event_type: "$page-view", event_at_ms: now + 100, data: { url: "https://example.com", path: "/" } },
      { event_type: "$click", event_at_ms: now + 200, data: { tag_name: "BUTTON", text: "Submit" } },
    ],
  });

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: "ok", event_count: 2 });
});

it("returns event_count 0 for empty events array", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await uploadEventBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: Date.now(),
    events: [],
  });

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: "ok", event_count: 0 });
});

it("rejects too many events", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const tooManyEvents = Array.from({ length: 5001 }, (_, i) => ({
    event_type: "$page-view",
    event_at_ms: 1_700_000_000_000 + i,
    data: { url: "https://example.com" },
  }));

  const res = await uploadEventBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    sentAtMs: 1_700_000_000_100,
    events: tooManyEvents,
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("rejects invalid browser_session_id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: "not-a-uuid",
      tab_id: randomUUID(),
      batch_id: randomUUID(),
      sent_at_ms: Date.now(),
      events: [{ event_type: "$page-view", event_at_ms: Date.now(), data: {} }],
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("rejects invalid batch_id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: randomUUID(),
      tab_id: randomUUID(),
      batch_id: "not-a-uuid",
      sent_at_ms: Date.now(),
      events: [{ event_type: "$page-view", event_at_ms: Date.now(), data: {} }],
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("rejects invalid tab_id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: randomUUID(),
      tab_id: "not-a-uuid",
      batch_id: randomUUID(),
      sent_at_ms: Date.now(),
      events: [{ event_type: "$page-view", event_at_ms: Date.now(), data: {} }],
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("rejects oversized payloads", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const hugeString = "a".repeat(5_100_000);

  const res = await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: randomUUID(),
      tab_id: randomUUID(),
      batch_id: randomUUID(),
      sent_at_ms: Date.now(),
      events: [{ event_type: "$page-view", event_at_ms: Date.now(), data: { big: hugeString } }],
    },
  });

  expect(res.status).toBe(413);
});
