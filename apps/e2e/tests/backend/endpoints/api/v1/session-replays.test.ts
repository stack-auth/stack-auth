import { randomUUID } from "node:crypto";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { it } from "../../../../helpers";
import { Auth, Project, Team, backendContext, bumpEmailAddress, niceBackendFetch } from "../../../backend-helpers";

async function uploadBatch(options: {
  browserSessionId: string,
  batchId: string,
  startedAtMs: number,
  sentAtMs: number,
  events: unknown[],
  sessionReplaySegmentId?: string,
}) {
  return await niceBackendFetch("/api/v1/session-replays/batch", {
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

  const res = await niceBackendFetch("/api/v1/session-replays/batch", {
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

it("throws error when analytics is not enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  // Analytics is disabled by default - do NOT call Project.updateConfig
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-replays/batch", {
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

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("ANALYTICS_NOT_ENABLED");
});

it("stores session replay batch metadata and dedupes by (session_replay_id, batch_id)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const now = Date.now();
  const browserSessionId = randomUUID();
  const batchId = randomUUID();
  const sessionReplaySegmentId = randomUUID();

  const first = await niceBackendFetch("/api/v1/session-replays/batch", {
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
  expect(typeof first.body?.session_replay_id).toBe("string");
  expect(first.body).toMatchObject({
    batch_id: batchId,
    deduped: false,
  });
  expect(typeof first.body?.s3_key).toBe("string");

  const recordingId = first.body?.session_replay_id;

  const second = await niceBackendFetch("/api/v1/session-replays/batch", {
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
    session_replay_id: recordingId,
    batch_id: batchId,
    deduped: true,
  });
});

it("rejects empty events", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-replays/batch", {
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

  const res = await niceBackendFetch("/api/v1/session-replays/batch", {
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

  const res = await niceBackendFetch("/api/v1/session-replays/batch", {
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

  const res = await niceBackendFetch("/api/v1/session-replays/batch", {
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

  const res = await niceBackendFetch("/api/v1/session-replays/batch", {
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

  const res = await niceBackendFetch("/api/v1/session-replays/batch", {
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
  expect(typeof res.body?.session_replay_id).toBe("string");
  expect(res.body).toMatchObject({
    batch_id: batchId,
    deduped: false,
  });
});

it("rejects non-integer started_at_ms", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await niceBackendFetch("/api/v1/session-replays/batch", {
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

  const res = await niceBackendFetch("/api/v1/session-replays/batch", {
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

it("admin can list session replays, list chunks, and fetch events", async ({ expect }) => {
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
  const recordingId = uploadRes.body?.session_replay_id;
  expect(typeof recordingId).toBe("string");

  const listRes = await niceBackendFetch("/api/v1/internal/session-replays", {
    method: "GET",
    accessType: "admin",
  });
  expect(listRes.status).toBe(200);
  expect(listRes.body?.items?.length).toBeGreaterThanOrEqual(1);

  const chunksRes = await niceBackendFetch(`/api/v1/internal/session-replays/${recordingId}/chunks`, {
    method: "GET",
    accessType: "admin",
  });
  expect(chunksRes.status).toBe(200);
  const chunkId = chunksRes.body?.items?.[0]?.id;
  expect(typeof chunkId).toBe("string");
  if (typeof chunkId !== "string") {
    throw new Error("Expected session replay chunks response to include an item id.");
  }

  const eventsRes = await niceBackendFetch(`/api/v1/internal/session-replays/${recordingId}/chunks/${chunkId}/events`, {
    method: "GET",
    accessType: "admin",
  });
  expect(eventsRes.status).toBe(200);
  expect(eventsRes.body?.events?.length).toBe(events.length);
});

it("admin list session replays paginates without skipping items", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });

  // Use separate sign-ins to get different refresh tokens → different session replays.
  await Auth.Otp.signIn();
  const uploadA = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_300,
    events: [{ type: 1, timestamp: 1_700_000_000_100 }],
  });
  expect(uploadA.status).toBe(200);
  const recordingA = uploadA.body?.session_replay_id;

  await Auth.Otp.signIn();
  const uploadB = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_400,
    events: [{ type: 1, timestamp: 1_700_000_000_200 }],
  });
  expect(uploadB.status).toBe(200);
  const recordingB = uploadB.body?.session_replay_id;

  const first = await niceBackendFetch("/api/v1/internal/session-replays?limit=1", {
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

  const second = await niceBackendFetch(`/api/v1/internal/session-replays?limit=1&cursor=${encodeURIComponent(nextCursor)}`, {
    method: "GET",
    accessType: "admin",
  });
  expect(second.status).toBe(200);
  expect(second.body?.items?.length).toBe(1);
  const secondId = second.body?.items?.[0]?.id;
  expect([recordingA, recordingB]).toContain(secondId);
  expect(secondId).not.toBe(firstId);
});

it("admin list session replays rejects unknown cursor", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const cursor = randomUUID();
  const res = await niceBackendFetch(`/api/v1/internal/session-replays?cursor=${encodeURIComponent(cursor)}`, {
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
  const recording1 = upload1a.body?.session_replay_id;

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
  const recording2 = upload2.body?.session_replay_id;

  const first = await niceBackendFetch(`/api/v1/internal/session-replays/${recording1}/chunks?limit=1`, {
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

  const second = await niceBackendFetch(`/api/v1/internal/session-replays/${recording1}/chunks?limit=1&cursor=${encodeURIComponent(nextCursor)}`, {
    method: "GET",
    accessType: "admin",
  });
  expect(second.status).toBe(200);
  expect(second.body?.items?.length).toBe(1);
  expect(second.body?.items?.[0]?.id).not.toBe(first.body?.items?.[0]?.id);

  // Cursor from another session should be rejected.
  const otherChunks = await niceBackendFetch(`/api/v1/internal/session-replays/${recording2}/chunks?limit=1`, {
    method: "GET",
    accessType: "admin",
  });
  expect(otherChunks.status).toBe(200);
  const otherCursor = otherChunks.body?.items?.[0]?.id;
  expect(typeof otherCursor).toBe("string");
  if (typeof otherCursor !== "string") {
    throw new Error("Expected otherCursor to be a string.");
  }

  const bad = await niceBackendFetch(`/api/v1/internal/session-replays/${recording1}/chunks?cursor=${encodeURIComponent(otherCursor)}`, {
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
  const recording1 = upload1.body?.session_replay_id;

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
  const recording2 = upload2.body?.session_replay_id;

  const chunks = await niceBackendFetch(`/api/v1/internal/session-replays/${recording1}/chunks`, {
    method: "GET",
    accessType: "admin",
  });
  expect(chunks.status).toBe(200);
  const chunkId = chunks.body?.items?.[0]?.id;
  expect(typeof chunkId).toBe("string");
  if (typeof chunkId !== "string") {
    throw new Error("Expected chunk id.");
  }

  const wrong = await niceBackendFetch(`/api/v1/internal/session-replays/${recording2}/chunks/${chunkId}/events`, {
    method: "GET",
    accessType: "admin",
  });
  expect(wrong.status).toBe(404);
  expect(wrong.body?.code).toBe("ITEM_NOT_FOUND");
});

it("non-admin access cannot call internal session replays endpoints", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const clientRes = await niceBackendFetch("/api/v1/internal/session-replays", {
    method: "GET",
    accessType: "client",
  });
  expect(clientRes.status).toBeGreaterThanOrEqual(400);
  expect(clientRes.status).toBeLessThan(500);

  const serverRes = await niceBackendFetch("/api/v1/internal/session-replays", {
    method: "GET",
    accessType: "server",
  });
  expect(serverRes.status).toBeGreaterThanOrEqual(400);
  expect(serverRes.status).toBeLessThan(500);
});

it("groups batches from same refresh token into one session replay", async ({ expect }) => {
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

  // Same refresh token within idle timeout → same session replay
  expect(upload1.body?.session_replay_id).toBe(upload2.body?.session_replay_id);
});

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

async function listReplays(queryParams: Record<string, string> = {}) {
  const params = new URLSearchParams(queryParams);
  const qs = params.toString();
  return await niceBackendFetch(`/api/v1/internal/session-replays${qs ? `?${qs}` : ""}`, {
    method: "GET",
    accessType: "admin",
  });
}

it("admin list session replays filters by user_ids", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });

  // User A
  const userA = await Auth.Otp.signIn();
  const uploadA = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_500,
    events: [{ type: 1, timestamp: 1_700_000_000_100 }],
  });
  expect(uploadA.status).toBe(200);

  // User B
  await bumpEmailAddress();
  const userB = await Auth.Otp.signIn();
  const uploadB = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_600,
    events: [{ type: 1, timestamp: 1_700_000_000_200 }],
  });
  expect(uploadB.status).toBe(200);

  // Filter by user A only
  const resA = await listReplays({ user_ids: userA.userId });
  expect(resA.status).toBe(200);
  expect(resA.body?.items?.length).toBe(1);
  expect(resA.body?.items?.[0]?.project_user?.id).toBe(userA.userId);

  // Filter by user B only
  const resB = await listReplays({ user_ids: userB.userId });
  expect(resB.status).toBe(200);
  expect(resB.body?.items?.length).toBe(1);
  expect(resB.body?.items?.[0]?.project_user?.id).toBe(userB.userId);

  // Filter by both users
  const resBoth = await listReplays({ user_ids: `${userA.userId},${userB.userId}` });
  expect(resBoth.status).toBe(200);
  expect(resBoth.body?.items?.length).toBe(2);

  // Filter by nonexistent user
  const resNone = await listReplays({ user_ids: randomUUID() });
  expect(resNone.status).toBe(200);
  expect(resNone.body?.items?.length).toBe(0);
});

it("admin list session replays filters by team_ids", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });

  // User A — member of a team
  const userA = await Auth.Otp.signIn();
  const uploadA = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_500,
    events: [{ type: 1, timestamp: 1_700_000_000_100 }],
  });
  expect(uploadA.status).toBe(200);

  const { teamId } = await Team.create({ accessType: "server", creatorUserId: userA.userId });

  // User B — not in any team
  await bumpEmailAddress();
  await Auth.Otp.signIn();
  const uploadB = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_600,
    events: [{ type: 1, timestamp: 1_700_000_000_200 }],
  });
  expect(uploadB.status).toBe(200);

  // Filter by team → only user A's replay
  const resTeam = await listReplays({ team_ids: teamId });
  expect(resTeam.status).toBe(200);
  expect(resTeam.body?.items?.length).toBe(1);
  expect(resTeam.body?.items?.[0]?.project_user?.id).toBe(userA.userId);

  // Nonexistent team → empty
  const resNone = await listReplays({ team_ids: randomUUID() });
  expect(resNone.status).toBe(200);
  expect(resNone.body?.items?.length).toBe(0);
});

it("admin list session replays filters by duration range", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });

  const baseTime = 1_700_000_000_000;

  // Short replay: 5 seconds (first event → last event = 5000ms)
  await Auth.Otp.signIn();
  const uploadShort = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: baseTime,
    sentAtMs: baseTime + 5500,
    events: [
      { type: 1, timestamp: baseTime },
      { type: 1, timestamp: baseTime + 5000 },
    ],
  });
  expect(uploadShort.status).toBe(200);
  const shortId = uploadShort.body?.session_replay_id;

  // Long replay: 30 seconds (first event → last event = 30000ms)
  await bumpEmailAddress();
  await Auth.Otp.signIn();
  const uploadLong = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: baseTime,
    sentAtMs: baseTime + 30500,
    events: [
      { type: 1, timestamp: baseTime },
      { type: 1, timestamp: baseTime + 30000 },
    ],
  });
  expect(uploadLong.status).toBe(200);
  const longId = uploadLong.body?.session_replay_id;

  // duration_ms_min=10000 → only long replay
  const resMin = await listReplays({ duration_ms_min: "10000" });
  expect(resMin.status).toBe(200);
  expect(resMin.body?.items?.length).toBe(1);
  expect(resMin.body?.items?.[0]?.id).toBe(longId);

  // duration_ms_max=10000 → only short replay
  const resMax = await listReplays({ duration_ms_max: "10000" });
  expect(resMax.status).toBe(200);
  expect(resMax.body?.items?.length).toBe(1);
  expect(resMax.body?.items?.[0]?.id).toBe(shortId);

  // duration range that includes both: 0–50000
  const resBoth = await listReplays({ duration_ms_min: "0", duration_ms_max: "50000" });
  expect(resBoth.status).toBe(200);
  expect(resBoth.body?.items?.length).toBe(2);

  // duration range that includes neither: 10000–20000
  const resNeither = await listReplays({ duration_ms_min: "10000", duration_ms_max: "20000" });
  expect(resNeither.status).toBe(200);
  expect(resNeither.body?.items?.length).toBe(0);
});

it("admin list session replays filters by last_event_at time range", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });

  const earlyTime = 1_700_000_000_000;
  const lateTime = 1_700_000_100_000; // 100 seconds later

  // Early replay
  await Auth.Otp.signIn();
  const uploadEarly = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: earlyTime,
    sentAtMs: earlyTime + 500,
    events: [{ type: 1, timestamp: earlyTime + 100 }],
  });
  expect(uploadEarly.status).toBe(200);
  const earlyId = uploadEarly.body?.session_replay_id;

  // Late replay
  await bumpEmailAddress();
  await Auth.Otp.signIn();
  const uploadLate = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    startedAtMs: lateTime,
    sentAtMs: lateTime + 500,
    events: [{ type: 1, timestamp: lateTime + 100 }],
  });
  expect(uploadLate.status).toBe(200);
  const lateId = uploadLate.body?.session_replay_id;

  // Filter from midpoint → only late replay
  const midpoint = earlyTime + 50_000;
  const resFrom = await listReplays({ last_event_at_from_millis: String(midpoint) });
  expect(resFrom.status).toBe(200);
  expect(resFrom.body?.items?.length).toBe(1);
  expect(resFrom.body?.items?.[0]?.id).toBe(lateId);

  // Filter to midpoint → only early replay
  const resTo = await listReplays({ last_event_at_to_millis: String(midpoint) });
  expect(resTo.status).toBe(200);
  expect(resTo.body?.items?.length).toBe(1);
  expect(resTo.body?.items?.[0]?.id).toBe(earlyId);

  // Filter range that includes both
  const resBoth = await listReplays({
    last_event_at_from_millis: String(earlyTime),
    last_event_at_to_millis: String(lateTime + 200),
  });
  expect(resBoth.status).toBe(200);
  expect(resBoth.body?.items?.length).toBe(2);
});

it("admin list session replays filters by click_count_min", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });

  const now = Date.now();

  // Replay A: user with 3 clicks
  await Auth.Otp.signIn();
  const segmentIdA = randomUUID();
  const uploadA = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    sessionReplaySegmentId: segmentIdA,
    startedAtMs: now,
    sentAtMs: now + 500,
    events: [{ type: 1, timestamp: now + 100 }],
  });
  expect(uploadA.status).toBe(200);
  const replayIdA = uploadA.body?.session_replay_id;

  const clickData = {
    tag_name: "button",
    text: "Click",
    href: null,
    selector: "button",
    x: 10,
    y: 20,
    page_x: 10,
    page_y: 20,
    viewport_width: 1920,
    viewport_height: 1080,
  };

  const eventBatchA = await uploadEventBatch({
    sessionReplaySegmentId: segmentIdA,
    batchId: randomUUID(),
    sentAtMs: now + 600,
    events: [
      { event_type: "$click", event_at_ms: now + 100, data: clickData },
      { event_type: "$click", event_at_ms: now + 200, data: clickData },
      { event_type: "$click", event_at_ms: now + 300, data: clickData },
    ],
  });
  expect(eventBatchA.status).toBe(200);

  // Replay B: user with 1 click
  await bumpEmailAddress();
  await Auth.Otp.signIn();
  const segmentIdB = randomUUID();
  const uploadB = await uploadBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    sessionReplaySegmentId: segmentIdB,
    startedAtMs: now,
    sentAtMs: now + 500,
    events: [{ type: 1, timestamp: now + 100 }],
  });
  expect(uploadB.status).toBe(200);
  const replayIdB = uploadB.body?.session_replay_id;

  const eventBatchB = await uploadEventBatch({
    sessionReplaySegmentId: segmentIdB,
    batchId: randomUUID(),
    sentAtMs: now + 600,
    events: [
      { event_type: "$click", event_at_ms: now + 100, data: clickData },
    ],
  });
  expect(eventBatchB.status).toBe(200);

  // Retry loop for ClickHouse eventual consistency
  let foundOnlyA = false;
  for (let i = 0; i < 15; i++) {
    const res = await listReplays({ click_count_min: "2" });
    expect(res.status).toBe(200);
    if (res.body?.items?.length === 1 && res.body?.items?.[0]?.id === replayIdA) {
      foundOnlyA = true;
      break;
    }
    await wait(500);
  }
  expect(foundOnlyA).toBe(true);

  // click_count_min=0 should return both (no-op filter)
  const resAll = await listReplays({ click_count_min: "0" });
  expect(resAll.status).toBe(200);
  expect(resAll.body?.items?.length).toBeGreaterThanOrEqual(2);
});

it("admin list session replays rejects invalid filter parameters", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Auth.Otp.signIn();

  // Non-integer duration_ms_min
  const res1 = await listReplays({ duration_ms_min: "abc" });
  expect(res1.status).toBe(400);

  // Negative duration_ms_min
  const res2 = await listReplays({ duration_ms_min: "-1" });
  expect(res2.status).toBe(400);

  // Non-integer duration_ms_max
  const res3 = await listReplays({ duration_ms_max: "12.5" });
  expect(res3.status).toBe(400);

  // Inverted duration range (min > max)
  const res4 = await listReplays({ duration_ms_min: "5000", duration_ms_max: "1000" });
  expect(res4.status).toBe(400);

  // NaN timestamp
  const res5 = await listReplays({ last_event_at_from_millis: "not-a-number" });
  expect(res5.status).toBe(400);

  // Inverted time range (from > to)
  const res6 = await listReplays({ last_event_at_from_millis: "2000", last_event_at_to_millis: "1000" });
  expect(res6.status).toBe(400);

  // Non-integer click_count_min
  const res7 = await listReplays({ click_count_min: "1.5" });
  expect(res7.status).toBe(400);

  // Negative click_count_min
  const res8 = await listReplays({ click_count_min: "-3" });
  expect(res8.status).toBe(400);
});
