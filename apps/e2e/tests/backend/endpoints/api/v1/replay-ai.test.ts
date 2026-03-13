import { randomUUID } from "node:crypto";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { it } from "../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../backend-helpers";

async function uploadReplayBatch(options: {
  browserSessionId: string,
  batchId: string,
  sessionReplaySegmentId: string,
  startedAtMs: number,
  sentAtMs: number,
  events: unknown[],
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
      events: options.events,
    },
  });
}

async function uploadAnalyticsEvents(options: {
  sessionReplaySegmentId: string,
  events: Array<{ event_type: string, event_at_ms: number, data: unknown }>,
  sentAtMs: number,
}) {
  return await niceBackendFetch("/api/v1/analytics/events/batch", {
    method: "POST",
    accessType: "client",
    body: {
      session_replay_segment_id: options.sessionReplaySegmentId,
      batch_id: randomUUID(),
      sent_at_ms: options.sentAtMs,
      events: options.events,
    },
  });
}

async function waitForReplaySummary(sessionReplayId: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await niceBackendFetch(`/api/v1/internal/analytics/replays/${sessionReplayId}/summary`, {
      method: "GET",
      accessType: "admin",
    });
    if (response.status === 200 && response.body?.status === "ready") {
      return response;
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for replay summary for ${sessionReplayId}`);
}

it("generates an AI replay summary after replay upload and reanalysis", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({
    apps: { installed: { analytics: { enabled: true } } },
    "analytics.ai.enabled": true,
    "analytics.ai.reanalysisOnReplayUpload": true,
  });
  await Auth.Otp.signIn();

  const sessionReplaySegmentId = randomUUID();
  const upload = await uploadReplayBatch({
    browserSessionId: randomUUID(),
    batchId: randomUUID(),
    sessionReplaySegmentId,
    startedAtMs: 1_700_000_000_000,
    sentAtMs: 1_700_000_000_800,
    events: [
      { type: 1, timestamp: 1_700_000_000_100 },
      { type: 2, timestamp: 1_700_000_000_200 },
      { type: 3, timestamp: 1_700_000_000_400 },
    ],
  });
  expect(upload.status).toBe(200);
  const replayId = upload.body?.session_replay_id;
  expect(typeof replayId).toBe("string");

  await uploadAnalyticsEvents({
    sessionReplaySegmentId,
    sentAtMs: 1_700_000_000_900,
    events: [
      { event_type: "$page-view", event_at_ms: 1_700_000_000_050, data: { path: "/sign-in", url: "https://example.com/sign-in" } },
      { event_type: "$click", event_at_ms: 1_700_000_000_120, data: { selector: "button.submit", path: "/sign-in" } },
      { event_type: "$error", event_at_ms: 1_700_000_000_180, data: { path: "/sign-in", message: "Cannot read properties of undefined" } },
    ],
  });

  await niceBackendFetch(`/api/v1/internal/analytics/replays/${replayId}/reanalyze`, {
    method: "POST",
    accessType: "admin",
  });

  const summaryResponse = await waitForReplaySummary(replayId);
  expect(summaryResponse.status).toBe(200);
  expect(summaryResponse.body?.status).toBe("ready");
  expect(summaryResponse.body?.issue_fingerprint).toContain("frontend-error");
  expect(summaryResponse.body?.severity).toBe("high");
  expect(summaryResponse.body?.evidence?.length).toBeGreaterThan(0);
});

it("clusters similar replay failures and returns similar replays", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({
    apps: { installed: { analytics: { enabled: true } } },
    "analytics.ai.enabled": true,
    "analytics.ai.reanalysisOnReplayUpload": true,
  });

  const replayIds: string[] = [];

  for (let index = 0; index < 2; index++) {
    await Auth.Otp.signIn();
    const sessionReplaySegmentId = randomUUID();
    const upload = await uploadReplayBatch({
      browserSessionId: randomUUID(),
      batchId: randomUUID(),
      sessionReplaySegmentId,
      startedAtMs: 1_700_000_001_000 + (index * 10_000),
      sentAtMs: 1_700_000_001_600 + (index * 10_000),
      events: [
        { type: 1, timestamp: 1_700_000_001_100 + (index * 10_000) },
        { type: 2, timestamp: 1_700_000_001_200 + (index * 10_000) },
      ],
    });
    const replayId = upload.body?.session_replay_id;
    if (typeof replayId !== "string") {
      throw new Error("Expected replay id");
    }
    replayIds.push(replayId);

    await uploadAnalyticsEvents({
      sessionReplaySegmentId,
      sentAtMs: 1_700_000_001_700 + (index * 10_000),
      events: [
        { event_type: "$page-view", event_at_ms: 1_700_000_001_010 + (index * 10_000), data: { path: "/checkout", url: "https://example.com/checkout" } },
        { event_type: "$network-error", event_at_ms: 1_700_000_001_150 + (index * 10_000), data: { path: "/checkout", url: "https://example.com/api/checkout", status: 500 } },
      ],
    });

    await niceBackendFetch(`/api/v1/internal/analytics/replays/${replayId}/reanalyze`, {
      method: "POST",
      accessType: "admin",
    });
  }

  await Promise.all(replayIds.map((replayId) => waitForReplaySummary(replayId)));

  const similar = await niceBackendFetch(`/api/v1/internal/analytics/replays/${replayIds[1]}/similar`, {
    method: "GET",
    accessType: "admin",
  });
  expect(similar.status).toBe(200);
  expect(similar.body?.items?.some((item: { session_replay_id: string }) => item.session_replay_id === replayIds[0])).toBe(true);

  const issues = await niceBackendFetch("/api/v1/internal/analytics/issues", {
    method: "GET",
    accessType: "admin",
  });
  expect(issues.status).toBe(200);
  expect(issues.body?.items?.some((item: { occurrence_count: number }) => item.occurrence_count >= 2)).toBe(true);
});
