import { afterEach, beforeEach, describe } from "vitest";
import { it } from "../helpers";
import { AiChatReviewer, niceBackendFetch } from "../backend/backend-helpers";
import { createCleanupScope, findManualQaEntryIdByQuestion, isSpacetimedbReachable, mintIdentity, sqlQuery, type CleanupScope } from "./helpers";

const canRun = await isSpacetimedbReachable();

function uniqueMarker(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function publishedQaContains(question: string): Promise<boolean> {
  const stranger = await mintIdentity();
  const { rows } = await sqlQuery(stranger.token, "SELECT * FROM published_qa");
  return rows.some(r => r.question === question);
}

describe.skipIf(!canRun)("published_qa visibility", () => {
  let scope: CleanupScope;
  beforeEach(() => {
    scope = createCleanupScope();
  });
  afterEach(async () => {
    await scope.cleanup();
  });

  it("does not expose rows added with publish:false", async ({ expect }) => {
    const reviewer = await mintIdentity();
    scope.trackIdentity(reviewer.identity);
    await AiChatReviewer.createReviewer();
    const enroll = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: reviewer.identity },
    });
    expect(enroll.status).toBe(200);

    const marker = uniqueMarker("unpublished");
    scope.trackMcpQuestion(marker);
    const add = await niceBackendFetch("/api/latest/internal/mcp-review/add-manual", {
      method: "POST",
      accessType: "client",
      body: { question: marker, answer: "x", publish: false },
    });
    expect(add.status).toBe(200);

    expect(await publishedQaContains(marker)).toBe(false);
  });

  it("removes a row from published_qa when update-qa-entry sets publish:false", async ({ expect }) => {
    const reviewer = await mintIdentity();
    scope.trackIdentity(reviewer.identity);
    await AiChatReviewer.createReviewer();
    const enroll = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: reviewer.identity },
    });
    expect(enroll.status).toBe(200);

    const marker = uniqueMarker("to-unpublish");
    scope.trackMcpQuestion(marker);
    const add = await niceBackendFetch("/api/latest/internal/mcp-review/add-manual", {
      method: "POST",
      accessType: "client",
      body: { question: marker, answer: "x", publish: true },
    });
    expect(add.status).toBe(200);
    expect(await publishedQaContains(marker)).toBe(true);

    const qaId = await findManualQaEntryIdByQuestion(reviewer.token, marker);
    expect(qaId).toBeDefined();

    const update = await niceBackendFetch("/api/latest/internal/mcp-review/update-qa-entry", {
      method: "POST",
      accessType: "client",
      body: {
        qaId: qaId!.toString(),
        question: marker,
        answer: "x",
        publish: false,
      },
    });
    expect(update.status).toBe(200);

    expect(await publishedQaContains(marker)).toBe(false);
  });

  it("removes a row from published_qa when deleted", async ({ expect }) => {
    const reviewer = await mintIdentity();
    scope.trackIdentity(reviewer.identity);
    await AiChatReviewer.createReviewer();
    const enroll = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: reviewer.identity },
    });
    expect(enroll.status).toBe(200);

    const marker = uniqueMarker("to-delete");
    scope.trackMcpQuestion(marker);
    const add = await niceBackendFetch("/api/latest/internal/mcp-review/add-manual", {
      method: "POST",
      accessType: "client",
      body: { question: marker, answer: "x", publish: true },
    });
    expect(add.status).toBe(200);
    expect(await publishedQaContains(marker)).toBe(true);

    const qaId = await findManualQaEntryIdByQuestion(reviewer.token, marker);
    expect(qaId).toBeDefined();

    const del = await niceBackendFetch("/api/latest/internal/mcp-review/delete", {
      method: "POST",
      accessType: "client",
      body: { qaId: qaId!.toString() },
    });
    expect(del.status).toBe(200);

    expect(await publishedQaContains(marker)).toBe(false);
  });

  it("lets reviewer B delete a row published by reviewer A (cross-reviewer integrity)", async ({ expect }) => {
    // A publishes.
    const reviewerA = await mintIdentity();
    scope.trackIdentity(reviewerA.identity);
    await AiChatReviewer.createReviewer();
    const enrollA = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: reviewerA.identity },
    });
    expect(enrollA.status).toBe(200);

    const marker = uniqueMarker("cross-reviewer");
    scope.trackMcpQuestion(marker);
    const add = await niceBackendFetch("/api/latest/internal/mcp-review/add-manual", {
      method: "POST",
      accessType: "client",
      body: { question: marker, answer: "x", publish: true },
    });
    expect(add.status).toBe(200);
    expect(await publishedQaContains(marker)).toBe(true);

    const qaId = await findManualQaEntryIdByQuestion(reviewerA.token, marker);
    expect(qaId).toBeDefined();

    // B deletes. fastSignUp re-points backendContext.userAuth to B; subsequent calls use B's auth.
    const reviewerB = await mintIdentity();
    scope.trackIdentity(reviewerB.identity);
    await AiChatReviewer.createReviewer();
    const enrollB = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: reviewerB.identity },
    });
    expect(enrollB.status).toBe(200);

    const del = await niceBackendFetch("/api/latest/internal/mcp-review/delete", {
      method: "POST",
      accessType: "client",
      body: { qaId: qaId!.toString() },
    });
    expect(del.status).toBe(200);

    expect(await publishedQaContains(marker)).toBe(false);
  });
});
