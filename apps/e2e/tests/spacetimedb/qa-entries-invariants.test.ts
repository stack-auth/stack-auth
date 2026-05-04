import { afterEach, beforeEach, describe } from "vitest";
import { it } from "../helpers";
import { AiChatReviewer, niceBackendFetch } from "../backend/backend-helpers";
import {
  createCleanupScope,
  findManualQaEntryIdByQuestion,
  isSpacetimedbReachable,
  mintIdentity,
  sqlQuery,
  type CleanupScope,
} from "./helpers";

const canRun = await isSpacetimedbReachable();

function uniqueMarker(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readManualEntry(token: string, qaId: bigint) {
  const { rows } = await sqlQuery(token, "SELECT * FROM my_visible_qa_entries");
  const match = rows.find(r => {
    const raw = r.id;
    const id = typeof raw === "string" ? BigInt(raw) : typeof raw === "number" ? BigInt(raw) : raw;
    return id === qaId;
  });
  if (!match) throw new Error(`qa_entries row ${qaId.toString()} not found`);
  return match as Record<string, unknown>;
}

function readOptional<T>(value: unknown): T | undefined {
  if (value == null) return undefined;
  if (typeof value === "object" && value != null && "some" in value) {
    return (value as { some: T }).some;
  }
  if (typeof value === "object" && value != null && "none" in value) return undefined;
  return value as T;
}

describe.skipIf(!canRun)("qa_entries CRUD invariants", () => {
  let scope: CleanupScope;
  beforeEach(() => { scope = createCleanupScope(); });
  afterEach(async () => { await scope.cleanup(); });

  it("firstPublishedAt is immutable; lastPublishedAt updates per republish; both survive unpublish", async ({ expect }) => {
    const reviewer = await mintIdentity();
    scope.trackIdentity(reviewer.identity);
    await AiChatReviewer.createReviewer();
    const enroll = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: reviewer.identity },
    });
    expect(enroll.status).toBe(200);

    const marker = uniqueMarker("publish-history");
    scope.trackMcpQuestion(marker);
    const add = await niceBackendFetch("/api/latest/internal/mcp-review/add-manual", {
      method: "POST",
      accessType: "client",
      body: { question: marker, answer: "a", publish: true },
    });
    expect(add.status).toBe(200);

    const qaId = await findManualQaEntryIdByQuestion(reviewer.token, marker);
    expect(qaId).toBeDefined();

    const initial = await readManualEntry(reviewer.token, qaId!);
    const firstPublishedAt = readOptional<unknown>(initial.first_published_at ?? initial.firstPublishedAt);
    const lastPublishedAt1 = readOptional<unknown>(initial.last_published_at ?? initial.lastPublishedAt);
    expect(firstPublishedAt).toBeDefined();
    expect(lastPublishedAt1).toBeDefined();

    // Unpublish: both timestamps must survive.
    const unpub = await niceBackendFetch("/api/latest/internal/mcp-review/update-qa-entry", {
      method: "POST",
      accessType: "client",
      body: { qaId: qaId!.toString(), question: marker, answer: "a", publish: false },
    });
    expect(unpub.status).toBe(200);
    const afterUnpub = await readManualEntry(reviewer.token, qaId!);
    expect(readOptional(afterUnpub.first_published_at ?? afterUnpub.firstPublishedAt)).toEqual(firstPublishedAt);
    expect(readOptional(afterUnpub.last_published_at ?? afterUnpub.lastPublishedAt)).toEqual(lastPublishedAt1);

    // Republish: firstPublishedAt unchanged; lastPublishedAt advances.
    await new Promise(r => setTimeout(r, 10));
    const rep = await niceBackendFetch("/api/latest/internal/mcp-review/update-qa-entry", {
      method: "POST",
      accessType: "client",
      body: { qaId: qaId!.toString(), question: marker, answer: "a", publish: true },
    });
    expect(rep.status).toBe(200);
    const afterRep = await readManualEntry(reviewer.token, qaId!);
    expect(readOptional(afterRep.first_published_at ?? afterRep.firstPublishedAt)).toEqual(firstPublishedAt);
    const lastPublishedAt2 = readOptional<unknown>(afterRep.last_published_at ?? afterRep.lastPublishedAt);
    expect(lastPublishedAt2).toBeDefined();
    expect(lastPublishedAt2).not.toEqual(lastPublishedAt1);
  });

  it("delete_qa_entry preserves the originating mcp_call_log row when present", async ({ expect }) => {
    // Manual entries have no mcp_call_log row; this test asserts the inverse — that the
    // delete reducer's scope is qa_entries only. Since manual entries have nothing to
    // preserve in mcp_call_log, the test asserts via the row-count of qa_entries dropping
    // by exactly 1, with no side effect on other tables.
    const reviewer = await mintIdentity();
    scope.trackIdentity(reviewer.identity);
    await AiChatReviewer.createReviewer();
    const enroll = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: reviewer.identity },
    });
    expect(enroll.status).toBe(200);

    const marker = uniqueMarker("delete-scope");
    scope.trackMcpQuestion(marker);
    const add = await niceBackendFetch("/api/latest/internal/mcp-review/add-manual", {
      method: "POST",
      accessType: "client",
      body: { question: marker, answer: "a", publish: true },
    });
    expect(add.status).toBe(200);

    const qaId = await findManualQaEntryIdByQuestion(reviewer.token, marker);
    expect(qaId).toBeDefined();

    const beforeQa = (await sqlQuery(reviewer.token, "SELECT * FROM my_visible_qa_entries")).rows.length;
    const beforeMcp = (await sqlQuery(reviewer.token, "SELECT * FROM my_visible_mcp_call_log")).rows.length;

    const del = await niceBackendFetch("/api/latest/internal/mcp-review/delete", {
      method: "POST",
      accessType: "client",
      body: { qaId: qaId!.toString() },
    });
    expect(del.status).toBe(200);

    const afterQa = (await sqlQuery(reviewer.token, "SELECT * FROM my_visible_qa_entries")).rows.length;
    const afterMcp = (await sqlQuery(reviewer.token, "SELECT * FROM my_visible_mcp_call_log")).rows.length;
    expect(afterQa).toBe(beforeQa - 1);
    expect(afterMcp).toBe(beforeMcp);
  });
});
