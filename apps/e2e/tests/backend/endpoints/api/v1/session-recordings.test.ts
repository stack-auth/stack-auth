import { randomUUID } from "node:crypto";
import { it } from "../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";

it("requires a user token", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  backendContext.set({ userAuth: null });

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_id: randomUUID(),
      batch_id: randomUUID(),
      started_at_ms: Date.now(),
      sent_at_ms: Date.now(),
      events: [{ timestamp: Date.now() }],
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("stores session recording batch metadata and dedupes by (session_id, batch_id)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const sessionId = randomUUID();
  const batchId = randomUUID();

  const first = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_id: sessionId,
      tab_id: randomUUID(),
      batch_id: batchId,
      started_at_ms: 1_700_000_000_000,
      sent_at_ms: 1_700_000_000_500,
      events: [
        { timestamp: 1_700_000_000_100, type: 2 },
        { timestamp: 1_700_000_000_200, type: 3 },
      ],
    },
  });

  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({
    session_id: sessionId,
    batch_id: batchId,
    deduped: false,
  });
  expect(typeof first.body?.s3_key).toBe("string");
  expect((first.body as any).s3_key).toContain(`/${sessionId}/${batchId}.json.gz`);

  const second = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_id: sessionId,
      batch_id: batchId,
      started_at_ms: 1_700_000_000_000,
      sent_at_ms: 1_700_000_000_500,
      events: [{ timestamp: 1_700_000_000_150, type: 2 }],
    },
  });

  expect(second.status).toBe(200);
  expect(second.body).toMatchObject({
    session_id: sessionId,
    batch_id: batchId,
    deduped: true,
  });
  expect((second.body as any).s3_key).toContain(`/${sessionId}/${batchId}.json.gz`);
});

it("rejects empty events", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_id: randomUUID(),
      batch_id: randomUUID(),
      started_at_ms: Date.now(),
      sent_at_ms: Date.now(),
      events: [],
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("rejects too many events", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const tooManyEvents = Array.from({ length: 5001 }, (_, i) => ({ timestamp: 1_700_000_000_000 + i }));

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_id: randomUUID(),
      batch_id: randomUUID(),
      started_at_ms: 1_700_000_000_000,
      sent_at_ms: 1_700_000_000_100,
      events: tooManyEvents,
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("rejects invalid session_id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_id: "not-a-uuid",
      batch_id: randomUUID(),
      started_at_ms: Date.now(),
      sent_at_ms: Date.now(),
      events: [{ timestamp: Date.now() }],
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("rejects invalid batch_id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_id: randomUUID(),
      batch_id: "not-a-uuid",
      started_at_ms: Date.now(),
      sent_at_ms: Date.now(),
      events: [{ timestamp: Date.now() }],
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("rejects invalid tab_id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_id: randomUUID(),
      tab_id: "not-a-uuid",
      batch_id: randomUUID(),
      started_at_ms: Date.now(),
      sent_at_ms: Date.now(),
      events: [{ timestamp: Date.now() }],
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("accepts events without timestamps (falls back to sent_at_ms)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const sessionId = randomUUID();
  const batchId = randomUUID();

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_id: sessionId,
      batch_id: batchId,
      started_at_ms: 1_700_000_000_000,
      sent_at_ms: 1_700_000_000_500,
      events: [{ type: 2 }, { type: 3, timestamp: undefined }],
    },
  });

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    session_id: sessionId,
    batch_id: batchId,
    deduped: false,
  });
});

it("rejects non-integer started_at_ms", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_id: randomUUID(),
      batch_id: randomUUID(),
      started_at_ms: 123.4,
      sent_at_ms: Date.now(),
      events: [{ timestamp: Date.now() }],
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("rejects oversized payloads", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  // Backend limit is 2_000_000 bytes; a single large string is sufficient to exceed it.
  const hugeString = "a".repeat(2_100_000);

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_id: randomUUID(),
      batch_id: randomUUID(),
      started_at_ms: Date.now(),
      sent_at_ms: Date.now(),
      events: [{ timestamp: Date.now(), data: hugeString }],
    },
  });

  expect(res.status).toBe(413);
});
