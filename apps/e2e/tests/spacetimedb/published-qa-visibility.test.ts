import { describe } from "vitest";
import { it } from "../helpers";
import { AiChatReviewer, niceBackendFetch } from "../backend/backend-helpers";
import { findCorrelationIdByQuestion, isSpacetimedbReachable, mintIdentity, sqlQuery } from "./helpers";

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
  it("does not expose rows added with publish:false", async ({ expect }) => {
    const reviewer = await mintIdentity();
    await AiChatReviewer.createReviewer();
    const enroll = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: reviewer.identity },
    });
    expect(enroll.status).toBe(200);

    const marker = uniqueMarker("unpublished");
    const add = await niceBackendFetch("/api/latest/internal/mcp-review/add-manual", {
      method: "POST",
      accessType: "client",
      body: { question: marker, answer: "x", publish: false },
    });
    expect(add.status).toBe(200);

    expect(await publishedQaContains(marker)).toBe(false);
  });

  it("removes a row from published_qa when update-correction sets publish:false", async ({ expect }) => {
    const reviewer = await mintIdentity();
    await AiChatReviewer.createReviewer();
    const enroll = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: reviewer.identity },
    });
    expect(enroll.status).toBe(200);

    const marker = uniqueMarker("to-unpublish");
    const add = await niceBackendFetch("/api/latest/internal/mcp-review/add-manual", {
      method: "POST",
      accessType: "client",
      body: { question: marker, answer: "x", publish: true },
    });
    expect(add.status).toBe(200);
    expect(await publishedQaContains(marker)).toBe(true);

    const correlationId = await findCorrelationIdByQuestion(reviewer.token, marker);
    expect(correlationId).toBeDefined();

    const update = await niceBackendFetch("/api/latest/internal/mcp-review/update-correction", {
      method: "POST",
      accessType: "client",
      body: {
        correlationId,
        correctedQuestion: marker,
        correctedAnswer: "x",
        publish: false,
      },
    });
    expect(update.status).toBe(200);

    expect(await publishedQaContains(marker)).toBe(false);
  });

  it("removes a row from published_qa when deleted", async ({ expect }) => {
    const reviewer = await mintIdentity();
    await AiChatReviewer.createReviewer();
    const enroll = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: reviewer.identity },
    });
    expect(enroll.status).toBe(200);

    const marker = uniqueMarker("to-delete");
    const add = await niceBackendFetch("/api/latest/internal/mcp-review/add-manual", {
      method: "POST",
      accessType: "client",
      body: { question: marker, answer: "x", publish: true },
    });
    expect(add.status).toBe(200);
    expect(await publishedQaContains(marker)).toBe(true);

    const correlationId = await findCorrelationIdByQuestion(reviewer.token, marker);
    expect(correlationId).toBeDefined();

    const del = await niceBackendFetch("/api/latest/internal/mcp-review/delete", {
      method: "POST",
      accessType: "client",
      body: { correlationId },
    });
    expect(del.status).toBe(200);

    expect(await publishedQaContains(marker)).toBe(false);
  });

  it("lets reviewer B delete a row published by reviewer A (cross-reviewer integrity)", async ({ expect }) => {
    // A publishes.
    const reviewerA = await mintIdentity();
    await AiChatReviewer.createReviewer();
    const enrollA = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: reviewerA.identity },
    });
    expect(enrollA.status).toBe(200);

    const marker = uniqueMarker("cross-reviewer");
    const add = await niceBackendFetch("/api/latest/internal/mcp-review/add-manual", {
      method: "POST",
      accessType: "client",
      body: { question: marker, answer: "x", publish: true },
    });
    expect(add.status).toBe(200);
    expect(await publishedQaContains(marker)).toBe(true);

    const correlationId = await findCorrelationIdByQuestion(reviewerA.token, marker);
    expect(correlationId).toBeDefined();

    // B deletes. fastSignUp re-points backendContext.userAuth to B; subsequent calls use B's auth.
    const reviewerB = await mintIdentity();
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
      body: { correlationId },
    });
    expect(del.status).toBe(200);

    expect(await publishedQaContains(marker)).toBe(false);
  });
});
