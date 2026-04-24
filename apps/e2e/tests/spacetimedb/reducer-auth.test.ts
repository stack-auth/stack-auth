import { afterEach, beforeEach, describe } from "vitest";
import { it } from "../helpers";
import { AiChatReviewer, niceBackendFetch } from "../backend/backend-helpers";
import { callReducer, createCleanupScope, getSpacetimedbConfig, isSpacetimedbReachable, mintIdentity, opt, sqlQuery, type CleanupScope } from "./helpers";

const canRun = await isSpacetimedbReachable();
const { logToken } = getSpacetimedbConfig();

function uniqueMarker(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe.skipIf(!canRun)("SpacetimeDB reducer auth", () => {
  let scope: CleanupScope;
  beforeEach(() => {
    scope = createCleanupScope();
  });
  afterEach(async () => {
    await scope.cleanup();
  });

  it("a freshly-minted non-operator identity sees zero rows in my_visible_mcp_call_log", async ({ expect }) => {
    // Seed a published row so the underlying mcp_call_log is definitely non-empty —
    // otherwise a 0-row result could be a false positive from an empty table.
    const reviewerIdentity = await mintIdentity();
    scope.trackIdentity(reviewerIdentity.identity);
    await AiChatReviewer.createReviewer();
    const enroll = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: reviewerIdentity.identity },
    });
    expect(enroll.status).toBe(200);
    const seedMarker = uniqueMarker("reducer-auth-seed");
    scope.trackMcpQuestion(seedMarker);
    const seedPublish = await niceBackendFetch("/api/latest/internal/mcp-review/add-manual", {
      method: "POST",
      accessType: "client",
      body: { question: seedMarker, answer: "a", publish: false },
    });
    expect(seedPublish.status).toBe(200);

    const stranger = await mintIdentity();
    const result = await sqlQuery(stranger.token, "SELECT * FROM my_visible_mcp_call_log");
    expect(result.rows.length).toBe(0);
  });

  // Smoke-test every mutating reducer's token gate. The existing add_operator test
  // above catches regressions on that one reducer specifically; this loop ensures
  // no new mutating reducer ships without a token check. If a reducer is added, it
  // must be added here too or this smoke covers one less attack surface.
  it("every mutating reducer rejects calls with a wrong log token", async ({ expect }) => {
    const caller = await mintIdentity();
    const victim = await mintIdentity();
    const wrong = "definitely-not-the-real-token";
    const hexId = `0x${victim.identity}`;

    const cases = [
      { name: "add_operator", args: [wrong, [hexId], "some-user", "Some Name"] },
      { name: "remove_operator", args: [wrong, [hexId]] },
      { name: "enroll_service", args: [wrong, "Some Service"] },
      { name: "mark_human_reviewed", args: [wrong, "corr", "reviewer"] },
      { name: "unmark_human_reviewed", args: [wrong, "corr"] },
      {
        name: "update_human_correction",
        args: [wrong, "corr", "q", "a", false, "reviewer"],
      },
      { name: "add_manual_qa", args: [wrong, "q", "a", false, "reviewer"] },
      { name: "delete_qa_entry", args: [wrong, "corr"] },
      {
        name: "log_mcp_call",
        args: [wrong, "corr", opt(null), "tool", "reason", "prompt", "q", "r", 0, "[]", 0n, "model", opt(null)],
      },
      {
        name: "update_mcp_qa_review",
        args: [wrong, "corr", false, false, false, "[]", "", 0, "model", opt(null), opt(null)],
      },
      {
        name: "log_ai_query",
        args: [wrong, "corr", "chat", "sys", "q", "s", "model", false, opt(null), opt(null), "[]", "[]", "[]", "text", opt(null), opt(null), opt(null), opt(null), 0, 0n, opt(null), opt(null), opt(null)],
      },
    ];

    for (const { name, args } of cases) {
      const result = await callReducer(caller.token, name, args);
      expect(result.ok, `reducer ${name} should reject wrong token`).toBe(false);
      expect(result.body, `reducer ${name} should report invalid-token error`).toContain("Invalid log token");
    }
  });

  it.skipIf(!logToken)(
    "rejects add_operator when an existing identity is claimed under a different stackUserId",
    async ({ expect }) => {
      // Enroll identity X with stackUserId=A via the backend endpoint (legitimate flow).
      const target = await mintIdentity();
      scope.trackIdentity(target.identity);
      const callerA = await mintIdentity();
      await AiChatReviewer.createReviewer();
      const enrollA = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
        method: "POST",
        accessType: "client",
        body: { identity: target.identity },
      });
      expect(enrollA.status).toBe(200);

      // Now directly call add_operator with a DIFFERENT stackUserId for the same identity.
      // Simulates an attacker with the log token trying to relabel X's row.
      const result = await callReducer(callerA.token, "add_operator", [
        logToken!,
        [`0x${target.identity}`],
        "attacker-different-stack-user-id",
        "Attacker Display Name",
      ]);

      expect(result.ok).toBe(false);
      expect(result.body).toContain("Identity is bound to a different Stack user");
    },
  );
});
