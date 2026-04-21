import { afterEach, beforeEach, describe } from "vitest";
import { it } from "../helpers";
import { AiChatReviewer, niceBackendFetch } from "../backend/backend-helpers";
import { callReducer, createCleanupScope, getSpacetimedbConfig, isSpacetimedbReachable, mintIdentity, sqlQuery, type CleanupScope } from "./helpers";

const canRun = await isSpacetimedbReachable();
const { logToken } = getSpacetimedbConfig();

describe.skipIf(!canRun)("operators table RLS", () => {
  let scope: CleanupScope;
  beforeEach(() => {
    scope = createCleanupScope();
  });
  afterEach(async () => {
    await scope.cleanup();
  });

  it("each reviewer sees only their own operators row", async ({ expect }) => {
    const a = await mintIdentity();
    scope.trackIdentity(a.identity);
    await AiChatReviewer.createReviewer();
    const enrollA = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: a.identity },
    });
    expect(enrollA.status).toBe(200);

    const b = await mintIdentity();
    scope.trackIdentity(b.identity);
    await AiChatReviewer.createReviewer();
    const enrollB = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: b.identity },
    });
    expect(enrollB.status).toBe(200);

    const asA = await sqlQuery(a.token, "SELECT * FROM operators");
    const asB = await sqlQuery(b.token, "SELECT * FROM operators");

    expect(asA.rows.length).toBe(1);
    expect(asB.rows.length).toBe(1);
    // Different reviewers must see different (own) rows — if RLS broke, both would see two.
    expect(JSON.stringify(asA.rows[0])).not.toEqual(JSON.stringify(asB.rows[0]));
  });

  it("a freshly-minted non-operator identity sees zero operators rows", async ({ expect }) => {
    // Seed at least one operator so the table isn't empty.
    const seeded = await mintIdentity();
    scope.trackIdentity(seeded.identity);
    await AiChatReviewer.createReviewer();
    const enroll = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: seeded.identity },
    });
    expect(enroll.status).toBe(200);

    const stranger = await mintIdentity();
    const { rows } = await sqlQuery(stranger.token, "SELECT * FROM operators");
    expect(rows.length).toBe(0);
  });

  it("enrolling a second identity as the same reviewer sweeps the first", async ({ expect }) => {
    // The add_operator reducer's sweep logic deletes prior rows with the same
    // stackUserId before inserting a new identity — a reviewer switching browsers
    // should not accumulate stale operator rows.
    const x = await mintIdentity();
    scope.trackIdentity(x.identity);
    await AiChatReviewer.createReviewer();
    const enrollX = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: x.identity },
    });
    expect(enrollX.status).toBe(200);

    // Same reviewer (backendContext.userAuth unchanged) enrolls a second identity.
    const y = await mintIdentity();
    scope.trackIdentity(y.identity);
    const enrollY = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: y.identity },
    });
    expect(enrollY.status).toBe(200);

    // X should no longer be in operators — sweep removed its row.
    const asX = await sqlQuery(x.token, "SELECT * FROM operators");
    expect(asX.rows.length).toBe(0);
    // Y should still be the active operator.
    const asY = await sqlQuery(y.token, "SELECT * FROM operators");
    expect(asY.rows.length).toBe(1);
  });

  it.skipIf(!logToken)(
    "remove_operator reducer revokes an operator's view access",
    async ({ expect }) => {
      const target = await mintIdentity();
      scope.trackIdentity(target.identity);
      await AiChatReviewer.createReviewer();
      const enroll = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
        method: "POST",
        accessType: "client",
        body: { identity: target.identity },
      });
      expect(enroll.status).toBe(200);

      // Confirm enrolled.
      const before = await sqlQuery(target.token, "SELECT * FROM operators");
      expect(before.rows.length).toBe(1);

      // Directly call remove_operator with the log token.
      const caller = await mintIdentity();
      const removed = await callReducer(caller.token, "remove_operator", [
        logToken!,
        [`0x${target.identity}`],
      ]);
      expect(removed.ok).toBe(true);

      // Target is no longer an operator.
      const after = await sqlQuery(target.token, "SELECT * FROM operators");
      expect(after.rows.length).toBe(0);
    },
  );
});
