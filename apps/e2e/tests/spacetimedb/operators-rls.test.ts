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

  it("enrolling a second identity as the same reviewer keeps both active", async ({ expect }) => {
    const x = await mintIdentity();
    scope.trackIdentity(x.identity);
    await AiChatReviewer.createReviewer();
    const enrollX = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: x.identity },
    });
    expect(enrollX.status).toBe(200);

    const y = await mintIdentity();
    scope.trackIdentity(y.identity);
    const enrollY = await niceBackendFetch("/api/latest/internal/spacetimedb-enroll-reviewer", {
      method: "POST",
      accessType: "client",
      body: { identity: y.identity },
    });
    expect(enrollY.status).toBe(200);
    const asX = await sqlQuery(x.token, "SELECT * FROM operators");
    expect(asX.rows.length).toBe(1);
    const asY = await sqlQuery(y.token, "SELECT * FROM operators");
    expect(asY.rows.length).toBe(1);
  });

  it.skipIf(!logToken)(
    "remove_operators_for_user revokes every device a user has enrolled",
    async ({ expect }) => {
      const targetA = await mintIdentity();
      scope.trackIdentity(targetA.identity);
      const targetB = await mintIdentity();
      scope.trackIdentity(targetB.identity);
      const stackUserId = `e2e-target-${targetA.identity}`;

      const enrollA = await callReducer(targetA.token, "add_operator", [
        logToken!,
        [`0x${targetA.identity}`],
        stackUserId,
        "E2E Target A",
      ]);
      expect(enrollA.ok).toBe(true);
      const enrollB = await callReducer(targetB.token, "add_operator", [
        logToken!,
        [`0x${targetB.identity}`],
        stackUserId,
        "E2E Target B",
      ]);
      expect(enrollB.ok).toBe(true);

      expect((await sqlQuery(targetA.token, "SELECT * FROM operators")).rows.length).toBe(1);
      expect((await sqlQuery(targetB.token, "SELECT * FROM operators")).rows.length).toBe(1);

      const removed = await callReducer(targetA.token, "remove_operators_for_user", [
        logToken!,
        stackUserId,
      ]);
      expect(removed.ok).toBe(true);

      expect((await sqlQuery(targetA.token, "SELECT * FROM operators")).rows.length).toBe(0);
      expect((await sqlQuery(targetB.token, "SELECT * FROM operators")).rows.length).toBe(0);
    },
  );
});
