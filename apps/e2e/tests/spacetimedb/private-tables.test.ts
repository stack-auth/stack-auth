import { describe } from "vitest";
import { it } from "../helpers";
import { AiChatReviewer, niceBackendFetch } from "../backend/backend-helpers";
import { callReducer, getSpacetimedbConfig, isSpacetimedbReachable, mintIdentity, opt, sqlQuery } from "./helpers";

const canRun = await isSpacetimedbReachable();
const { logToken } = getSpacetimedbConfig();

describe.skipIf(!canRun)("private log tables and view gating", () => {
  // my_visible_ai_query_log is the counterpart to my_visible_mcp_call_log. Seeding
  // requires the log token (no user-facing endpoint writes to ai_query_log), so
  // skip when unavailable rather than asserting against an empty table.
  it.skipIf(!logToken)(
    "a freshly-minted non-operator identity sees zero rows in my_visible_ai_query_log",
    async ({ expect }) => {
      const seeder = await mintIdentity();
      const seed = await callReducer(seeder.token, "log_ai_query", [
        logToken!,
        `corr-${Date.now()}`,
        "chat",
        "system-prompt-id",
        "high",
        "fast",
        "some-model",
        false,
        opt(null),
        opt(null),
        "[]",
        "[]",
        "[]",
        "final text",
        opt(null),
        opt(null),
        opt(null),
        opt(null),
        0,
        0n,
        opt(null),
        opt(null),
        opt(null),
      ]);
      expect(seed.ok).toBe(true);

      const stranger = await mintIdentity();
      const { rows } = await sqlQuery(stranger.token, "SELECT * FROM my_visible_ai_query_log");
      expect(rows.length).toBe(0);
    },
  );

  it("cannot subscribe to the private mcp_call_log table directly", async ({ expect }) => {
    // Seed a row so the table isn't empty — we're testing access control, not emptiness.
    const seeder = await mintIdentity();
    await AiChatReviewer.createReviewer();
    const enroll = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: seeder.identity },
    });
    expect(enroll.status).toBe(200);
    const seed = await niceBackendFetch("/api/latest/internal/mcp-review/add-manual", {
      method: "POST",
      accessType: "client",
      body: { question: "seeded", answer: "a", publish: false },
    });
    expect(seed.status).toBe(200);

    // Private table: SpacetimeDB should either reject the query outright or return
    // zero rows to non-operators. Either outcome is acceptable — the invariant is
    // "the caller does not see any private-table rows." If rejection, the error
    // must come from our own sqlQuery helper's HTTP-4xx path against this exact
    // table (not a network blip, not a helper regression).
    const stranger = await mintIdentity();
    const result = await sqlQuery(stranger.token, "SELECT * FROM mcp_call_log")
      .then(r => ({ ok: true as const, rows: r.rows }))
      .catch(err => ({ ok: false as const, err }));
    if (result.ok) {
      expect(result.rows.length).toBe(0);
    } else {
      expect(result.err).toBeInstanceOf(Error);
      expect((result.err as Error).message).toMatch(
        /SQL\s+"SELECT \* FROM mcp_call_log"\s+failed: HTTP 4\d\d/,
      );
    }
  });

  it.skipIf(!logToken)(
    "cannot subscribe to the private ai_query_log table directly",
    async ({ expect }) => {
      const seeder = await mintIdentity();
      const seed = await callReducer(seeder.token, "log_ai_query", [
        logToken!,
        `corr-${Date.now()}`,
        "chat",
        "system-prompt-id",
        "high",
        "fast",
        "some-model",
        false,
        opt(null),
        opt(null),
        "[]",
        "[]",
        "[]",
        "final text",
        opt(null),
        opt(null),
        opt(null),
        opt(null),
        0,
        0n,
        opt(null),
        opt(null),
        opt(null),
      ]);
      expect(seed.ok).toBe(true);

      const stranger = await mintIdentity();
      const result = await sqlQuery(stranger.token, "SELECT * FROM ai_query_log")
        .then(r => ({ ok: true as const, rows: r.rows }))
        .catch(err => ({ ok: false as const, err }));
      if (result.ok) {
        expect(result.rows.length).toBe(0);
      } else {
        expect(result.err).toBeInstanceOf(Error);
        expect((result.err as Error).message).toMatch(
          /SQL\s+"SELECT \* FROM ai_query_log"\s+failed: HTTP 4\d\d/,
        );
      }
    },
  );
});
