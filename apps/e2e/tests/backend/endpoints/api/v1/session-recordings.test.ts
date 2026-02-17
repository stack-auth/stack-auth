import { randomUUID } from "node:crypto";
import { it } from "../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";

async function uploadBatch(options: {
  browserSessionId: string,
  batchId: string,
  startedAtMs: number,
  sentAtMs: number,
  events: unknown[],
  sessionReplaySegmentId?: string,
}) {
  return await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: options.browserSessionId,
      session_replay_segment_id: options.sessionReplaySegmentId ?? randomUUID(),
      batch_id: options.batchId,
      started_at_ms: options.startedAtMs,
      sent_at_ms: options.sentAtMs,
      events: options.events,
    },
  });
}

it("requires a user token", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  backendContext.set({ userAuth: null });

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: randomUUID(),
      session_replay_segment_id: randomUUID(),
      batch_id: randomUUID(),
      started_at_ms: Date.now(),
      sent_at_ms: Date.now(),
      events: [{ timestamp: Date.now() }],
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("returns 200 no-op when analytics is not enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  // Analytics is disabled by default - do NOT call Project.updateConfig
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: randomUUID(),
      session_replay_segment_id: randomUUID(),
      batch_id: randomUUID(),
      started_at_ms: Date.now(),
      sent_at_ms: Date.now(),
      events: [{ timestamp: Date.now() }],
    },
  });

  expect(res.status).toBe(200);
  expect(res.body?.session_recording_id).toBe("");
  expect(res.body?.s3_key).toBe("");
});

it("stores session recording batch metadata and dedupes by (session_recording_id, batch_id)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const now = Date.now();
  const browserSessionId = randomUUID();
  const batchId = randomUUID();
  const sessionReplaySegmentId = randomUUID();

  const first = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: browserSessionId,
      session_replay_segment_id: sessionReplaySegmentId,
      batch_id: batchId,
      started_at_ms: now,
      sent_at_ms: now + 500,
      events: [
        { timestamp: now + 100, type: 2 },
        { timestamp: now + 200, type: 3 },
      ],
    },
  });

  expect(first.status).toBe(200);
  expect(typeof first.body?.session_recording_id).toBe("string");
  expect(first.body).toMatchObject({
    batch_id: batchId,
    deduped: false,
  });
  expect(typeof first.body?.s3_key).toBe("string");

  const recordingId = first.body?.session_recording_id;

  const second = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: browserSessionId,
      session_replay_segment_id: sessionReplaySegmentId,
      batch_id: batchId,
      started_at_ms: now,
      sent_at_ms: now + 500,
      events: [{ timestamp: now + 150, type: 2 }],
    },
  });

  expect(second.status).toBe(200);
  expect(second.body).toMatchObject({
    session_recording_id: recordingId,
    batch_id: batchId,
    deduped: true,
  });
});

it("rejects empty events", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: randomUUID(),
      session_replay_segment_id: randomUUID(),
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
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const tooManyEvents = Array.from({ length: 5001 }, (_, i) => ({ timestamp: 1_700_000_000_000 + i }));

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: randomUUID(),
      session_replay_segment_id: randomUUID(),
      batch_id: randomUUID(),
      started_at_ms: 1_700_000_000_000,
      sent_at_ms: 1_700_000_000_100,
      events: tooManyEvents,
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("rejects invalid browser_session_id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: "not-a-uuid",
      session_replay_segment_id: randomUUID(),
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
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: randomUUID(),
      session_replay_segment_id: randomUUID(),
      batch_id: "not-a-uuid",
      started_at_ms: Date.now(),
      sent_at_ms: Date.now(),
      events: [{ timestamp: Date.now() }],
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

it("rejects invalid session_replay_segment_id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: randomUUID(),
      session_replay_segment_id: "not-a-uuid",
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
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const browserSessionId = randomUUID();
  const batchId = randomUUID();

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: browserSessionId,
      session_replay_segment_id: randomUUID(),
      batch_id: batchId,
      started_at_ms: 1_700_000_000_000,
      sent_at_ms: 1_700_000_000_500,
      events: [{ type: 2 }, { type: 3, timestamp: undefined }],
    },
  });

  expect(res.status).toBe(200);
  expect(typeof res.body?.session_recording_id).toBe("string");
  expect(res.body).toMatchObject({
    batch_id: batchId,
    deduped: false,
  });
});

it("rejects non-integer started_at_ms", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: randomUUID(),
      session_replay_segment_id: randomUUID(),
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
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  // Backend limit is 5_000_000 bytes; a single large string is sufficient to exceed it.
  const hugeString = "a".repeat(5_100_000);

  const res = await niceBackendFetch("/api/v1/session-recordings/batch", {
    method: "POST",
    accessType: "client",
    body: {
      browser_session_id: randomUUID(),
      session_replay_segment_id: randomUUID(),
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
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const browserSessionId = randomUUID();
  const batchId = randomUUID();
  const events = [
    { type: 1, timestamp: 1_700_000_000_100, data: { a: 1 } },
    { type: 2, timestamp: 1_700_000_000_200, data: { b: 2 } },
  ];

  const uploadRes = await uploadBatch({
    browserSessionId,
    batchId,
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_500,
    events,
  });
  expect(uploadRes.status).toBe(200);
  const recordingId = uploadRes.body?.session_recording_id;
  expect(typeof recordingId).toBe("string");

  const listRes = await niceBackendFetch("/api/v1/internal/session-recordings", {
    method: "GET",
    accessType: "admin",
  });
  expect(listRes.status).toBe(200);
  expect(listRes.body?.items?.length).toBeGreaterThanOrEqual(1);

  const chunksRes = await niceBackendFetch(`/api/v1/internal/session-recordings/${recordingId}/chunks`, {
    method: "GET",
    accessType: "admin",
  });
  expect(chunksRes.status).toBe(200);
  const chunkId = chunksRes.body?.items?.[0]?.id;
  expect(typeof chunkId).toBe("string");
  if (typeof chunkId !== "string") {
    throw new Error("Expected session recording chunks response to include an item id.");
  }

  const eventsRes = await niceBackendFetch(`/api/v1/internal/session-recordings/${recordingId}/chunks/${chunkId}/events`, {
    method: "GET",
    accessType: "admin",
  });
  expect(eventsRes.status).toBe(200);
  expect(eventsRes.body?.events?.length).toBe(events.length);
});

it("admin list session recordings paginates without skipping items", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });

  // Use separate sign-ins to get different refresh tokens → different session recordings.
  await Auth.Otp.signIn();
  const uploadA = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_300,
    events: [{ type: 1, timestamp: 1_700_000_000_100 }],
  });
  expect(uploadA.status).toBe(200);
  const recordingA = uploadA.body?.session_recording_id;

  await Auth.Otp.signIn();
  const uploadB = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_400,
    events: [{ type: 1, timestamp: 1_700_000_000_200 }],
  });
  expect(uploadB.status).toBe(200);
  const recordingB = uploadB.body?.session_recording_id;

  const first = await niceBackendFetch("/api/v1/internal/session-recordings?limit=1", {
    method: "GET",
    accessType: "admin",
  });
  expect(first.status).toBe(200);
  expect(first.body?.items?.length).toBe(1);
  const firstId = first.body?.items?.[0]?.id;
  expect([recordingA, recordingB]).toContain(firstId);

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
  expect([recordingA, recordingB]).toContain(secondId);
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
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });

  const now = Date.now();

  // session1: two batches under first refresh token
  await Auth.Otp.signIn();
  const upload1a = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: now,
    sentAtMs: now + 500,
    events: [{ type: 1, timestamp: now + 10 }],
  });
  expect(upload1a.status).toBe(200);
  const recording1 = upload1a.body?.session_recording_id;

  await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: now,
    sentAtMs: now + 600,
    events: [{ type: 1, timestamp: now + 20 }],
  });

  // session2: one batch under a different refresh token
  await Auth.Otp.signIn();
  const upload2 = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: now,
    sentAtMs: now + 700,
    events: [{ type: 1, timestamp: now + 30 }],
  });
  expect(upload2.status).toBe(200);
  const recording2 = upload2.body?.session_recording_id;

  const first = await niceBackendFetch(`/api/v1/internal/session-recordings/${recording1}/chunks?limit=1`, {
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

  const second = await niceBackendFetch(`/api/v1/internal/session-recordings/${recording1}/chunks?limit=1&cursor=${encodeURIComponent(nextCursor)}`, {
    method: "GET",
    accessType: "admin",
  });
  expect(second.status).toBe(200);
  expect(second.body?.items?.length).toBe(1);
  expect(second.body?.items?.[0]?.id).not.toBe(first.body?.items?.[0]?.id);

  // Cursor from another session should be rejected.
  const otherChunks = await niceBackendFetch(`/api/v1/internal/session-recordings/${recording2}/chunks?limit=1`, {
    method: "GET",
    accessType: "admin",
  });
  expect(otherChunks.status).toBe(200);
  const otherCursor = otherChunks.body?.items?.[0]?.id;
  expect(typeof otherCursor).toBe("string");
  if (typeof otherCursor !== "string") {
    throw new Error("Expected otherCursor to be a string.");
  }

  const bad = await niceBackendFetch(`/api/v1/internal/session-recordings/${recording1}/chunks?cursor=${encodeURIComponent(otherCursor)}`, {
    method: "GET",
    accessType: "admin",
  });
  expect(bad.status).toBe(404);
  expect(bad.body?.code).toBe("ITEM_NOT_FOUND");
});

it("admin events endpoint does not allow fetching a chunk via the wrong session id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });

  // session1: upload under first refresh token
  await Auth.Otp.signIn();
  const batchId = randomUUID();
  const upload1 = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId,
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_500,
    events: [{ type: 1, timestamp: 1_700_000_000_010 }],
  });
  expect(upload1.status).toBe(200);
  const recording1 = upload1.body?.session_recording_id;

  // session2: upload under a different refresh token
  await Auth.Otp.signIn();
  const upload2 = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_600,
    events: [{ type: 1, timestamp: 1_700_000_000_020 }],
  });
  expect(upload2.status).toBe(200);
  const recording2 = upload2.body?.session_recording_id;

  const chunks = await niceBackendFetch(`/api/v1/internal/session-recordings/${recording1}/chunks`, {
    method: "GET",
    accessType: "admin",
  });
  expect(chunks.status).toBe(200);
  const chunkId = chunks.body?.items?.[0]?.id;
  expect(typeof chunkId).toBe("string");
  if (typeof chunkId !== "string") {
    throw new Error("Expected chunk id.");
  }

  const wrong = await niceBackendFetch(`/api/v1/internal/session-recordings/${recording2}/chunks/${chunkId}/events`, {
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

it("groups batches from same refresh token into one session recording", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const now = Date.now();

  // Two batches with different browser_session_ids but same refresh token
  const upload1 = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: now,
    sentAtMs: now + 300,
    events: [{ type: 1, timestamp: now + 100 }],
  });
  expect(upload1.status).toBe(200);

  const upload2 = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: now,
    sentAtMs: now + 400,
    events: [{ type: 1, timestamp: now + 200 }],
  });
  expect(upload2.status).toBe(200);

  // Same refresh token within idle timeout → same session recording
  expect(upload1.body?.session_recording_id).toBe(upload2.body?.session_recording_id);
});
