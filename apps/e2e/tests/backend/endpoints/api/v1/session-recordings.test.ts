import { randomUUID } from "node:crypto";
import { it } from "../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";

async function uploadBatch(options: {
  sessionId: string,
  batchId: string,
  startedAtMs: number,
  sentAtMs: number,
  events: unknown[],
  tabId?: string,
}) {
  return await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_id: options.sessionId,
      ...(options.tabId ? { tab_id: options.tabId } : {}),
      batch_id: options.batchId,
      started_at_ms: options.startedAtMs,
      sent_at_ms: options.sentAtMs,
      events: options.events,
    },
  });
}

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

it("admin can list session recordings, list chunks, and fetch events", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const sessionId = randomUUID();
  const batchId = randomUUID();
  const events = [
    { type: 1, timestamp: 1_700_000_000_100, data: { a: 1 } },
    { type: 2, timestamp: 1_700_000_000_200, data: { b: 2 } },
  ];

  const uploadRes = await uploadBatch({
    sessionId,
    batchId,
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_500,
    events,
  });
  expect(uploadRes.status).toBe(200);

  const listRes = await niceBackendFetch("/api/v1/internal/session-recordings", {
    method: "GET",
    accessType: "admin",
  });
  expect(listRes.status).toBe(200);
  expect(listRes.body?.items?.length).toBeGreaterThanOrEqual(1);

  const chunksRes = await niceBackendFetch(`/api/v1/internal/session-recordings/${sessionId}/chunks`, {
    method: "GET",
    accessType: "admin",
  });
  expect(chunksRes.status).toBe(200);
  const chunkId = chunksRes.body?.items?.[0]?.id;
  expect(typeof chunkId).toBe("string");
  if (typeof chunkId !== "string") {
    throw new Error("Expected session recording chunks response to include an item id.");
  }

  const eventsRes = await niceBackendFetch(`/api/v1/internal/session-recordings/${sessionId}/chunks/${chunkId}/events`, {
    method: "GET",
    accessType: "admin",
  });
  expect(eventsRes.status).toBe(200);
  expect(eventsRes.body?.events?.length).toBe(events.length);
});

it("admin list session recordings paginates without skipping items", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const sessionA = randomUUID();
  const sessionB = randomUUID();

  await uploadBatch({
    sessionId: sessionA,
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_300,
    events: [{ type: 1, timestamp: 1_700_000_000_100 }],
  });
  await uploadBatch({
    sessionId: sessionB,
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_400,
    events: [{ type: 1, timestamp: 1_700_000_000_200 }],
  });

  const first = await niceBackendFetch("/api/v1/internal/session-recordings?limit=1", {
    method: "GET",
    accessType: "admin",
  });
  expect(first.status).toBe(200);
  expect(first.body?.items?.length).toBe(1);
  const firstId = first.body?.items?.[0]?.id;
  expect([sessionA, sessionB]).toContain(firstId);

  const nextCursor = first.body?.pagination?.next_cursor;
  expect(typeof nextCursor).toBe("string");
  if (typeof nextCursor !== "string") {
    throw new Error("Expected next_cursor to be a string.");
  }

  const second = await niceBackendFetch(`/api/v1/internal/session-recordings?limit=1&cursor=${encodeURIComponent(nextCursor)}`, {
    method: "GET",
    accessType: "admin",
  });
  expect(second.status).toBe(200);
  expect(second.body?.items?.length).toBe(1);
  const secondId = second.body?.items?.[0]?.id;
  expect([sessionA, sessionB]).toContain(secondId);
  expect(secondId).not.toBe(firstId);
});

it("admin list session recordings rejects unknown cursor", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const cursor = randomUUID();
  const res = await niceBackendFetch(`/api/v1/internal/session-recordings?cursor=${encodeURIComponent(cursor)}`, {
    method: "GET",
    accessType: "admin",
  });

  expect(res.status).toBe(404);
  expect(res.body?.code).toBe("ITEM_NOT_FOUND");
});

it("admin list chunks paginates and rejects a cursor from another session", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const session1 = randomUUID();
  const session2 = randomUUID();

  await uploadBatch({
    sessionId: session1,
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_500,
    events: [{ type: 1, timestamp: 1_700_000_000_010 }],
  });
  await uploadBatch({
    sessionId: session1,
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_600,
    events: [{ type: 1, timestamp: 1_700_000_000_020 }],
  });

  await uploadBatch({
    sessionId: session2,
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_700,
    events: [{ type: 1, timestamp: 1_700_000_000_030 }],
  });

  const first = await niceBackendFetch(`/api/v1/internal/session-recordings/${session1}/chunks?limit=1`, {
    method: "GET",
    accessType: "admin",
  });
  expect(first.status).toBe(200);
  expect(first.body?.items?.length).toBe(1);

  const nextCursor = first.body?.pagination?.next_cursor;
  expect(typeof nextCursor).toBe("string");
  if (typeof nextCursor !== "string") {
    throw new Error("Expected next_cursor to be a string.");
  }

  const second = await niceBackendFetch(`/api/v1/internal/session-recordings/${session1}/chunks?limit=1&cursor=${encodeURIComponent(nextCursor)}`, {
    method: "GET",
    accessType: "admin",
  });
  expect(second.status).toBe(200);
  expect(second.body?.items?.length).toBe(1);
  expect(second.body?.items?.[0]?.id).not.toBe(first.body?.items?.[0]?.id);

  // Cursor from another session should be rejected.
  const otherChunks = await niceBackendFetch(`/api/v1/internal/session-recordings/${session2}/chunks?limit=1`, {
    method: "GET",
    accessType: "admin",
  });
  expect(otherChunks.status).toBe(200);
  const otherCursor = otherChunks.body?.items?.[0]?.id;
  expect(typeof otherCursor).toBe("string");
  if (typeof otherCursor !== "string") {
    throw new Error("Expected otherCursor to be a string.");
  }

  const bad = await niceBackendFetch(`/api/v1/internal/session-recordings/${session1}/chunks?cursor=${encodeURIComponent(otherCursor)}`, {
    method: "GET",
    accessType: "admin",
  });
  expect(bad.status).toBe(404);
  expect(bad.body?.code).toBe("ITEM_NOT_FOUND");
});

it("admin events endpoint does not allow fetching a chunk via the wrong session id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const session1 = randomUUID();
  const session2 = randomUUID();
  const batchId = randomUUID();

  await uploadBatch({
    sessionId: session1,
    batchId,
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_500,
    events: [{ type: 1, timestamp: 1_700_000_000_010 }],
  });
  await uploadBatch({
    sessionId: session2,
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_600,
    events: [{ type: 1, timestamp: 1_700_000_000_020 }],
  });

  const chunks = await niceBackendFetch(`/api/v1/internal/session-recordings/${session1}/chunks`, {
    method: "GET",
    accessType: "admin",
  });
  expect(chunks.status).toBe(200);
  const chunkId = chunks.body?.items?.[0]?.id;
  expect(typeof chunkId).toBe("string");
  if (typeof chunkId !== "string") {
    throw new Error("Expected chunk id.");
  }

  const wrong = await niceBackendFetch(`/api/v1/internal/session-recordings/${session2}/chunks/${chunkId}/events`, {
    method: "GET",
    accessType: "admin",
  });
  expect(wrong.status).toBe(404);
  expect(wrong.body?.code).toBe("ITEM_NOT_FOUND");
});

it("non-admin access cannot call internal session recordings endpoints", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const clientRes = await niceBackendFetch("/api/v1/internal/session-recordings", {
    method: "GET",
    accessType: "client",
  });
  expect(clientRes.status).toBeGreaterThanOrEqual(400);
  expect(clientRes.status).toBeLessThan(500);

  const serverRes = await niceBackendFetch("/api/v1/internal/session-recordings", {
    method: "GET",
    accessType: "server",
  });
  expect(serverRes.status).toBeGreaterThanOrEqual(400);
  expect(serverRes.status).toBeLessThan(500);
});
