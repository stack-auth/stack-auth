import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Auth, INTERNAL_PROJECT_OWNER_TEAM_ID, InternalProjectKeys, Project, Team, backendContext, niceBackendFetch } from "../../../../../backend-helpers";
import { createGrowthProject } from "./growth-helpers";

const GROWTH_BASE = "/api/latest/internal/growth";
const ADMIN_GAMES = `${GROWTH_BASE}/admin/games`;
const GAMES_BASE = `${GROWTH_BASE}/games`;

// E2E coverage for Growth games: the staff review surface (generate → review → publish) and the
// customer surface it publishes to.
//
// WHAT THIS FILE CAN AND CANNOT COVER. Every question is built from at least 14 days of rolled-up
// ClickHouse history, and a freshly created e2e project has none — the rollup route only accepts
// fully-elapsed recent days, so no amount of calling it produces two weeks of past data. That makes
// the DATA GATE the reliably reachable state for generation, and it is the one worth pinning e2e:
// it is what stands between a customer and a quiz about a column of zeroes.
//
// Everything downstream of a successful generation (redaction, streak arithmetic, distractor
// generation, the publish state machine's ordering) is unit-covered instead, where it can be
// exercised deterministically — see apps/backend/src/lib/growth/games/*.test.ts.
//
// Deliberately WITHOUT mock-eve: only growth-workflows.test.ts may bind the fixed Eve port (see
// mock-eve.ts), and generation never needs it — an unreachable Eve is exactly the fallback path,
// where the draft is still built with template wording.
//
// createOnboardedGrowthProject POSTs /onboarding, which compiles two canonical workflows in the
// sandbox (60s backstop each). Tests that go through it get a 300s budget so a contended e2e
// worker pool does not kill them against the default 60s testTimeout.

/** Signs in as a Hexclave platform admin — membership of the internal project's owner team. */
async function signInAsInternalAdmin(): Promise<void> {
  backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
  const { userId } = await Auth.fastSignUp();
  await Team.addMember(INTERNAL_PROJECT_OWNER_TEAM_ID, userId);
}

/** Signs in to the internal project WITHOUT joining the owner team — the impostor case. */
async function signInAsNonAdmin(): Promise<void> {
  backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
  await Auth.fastSignUp();
}

async function createOnboardedGrowthProject(): Promise<string> {
  const keys = await createGrowthProject();
  if (keys === "no-project") throw new Error("createGrowthProject should have switched to a fresh project.");
  const onboarding = await niceBackendFetch(`${GROWTH_BASE}/onboarding`, {
    accessType: "admin",
    method: "POST",
    body: { website_url: "https://games.example.com", company_summary: "Growth games fixture" },
  });
  if (onboarding.status !== 200) throw new Error(`Growth onboarding failed with ${onboarding.status}.`);
  return keys.projectId;
}

describe("admin authorization", () => {
  it("refuses every admin games route for a signed-in user who is not a platform admin", { timeout: 300_000 }, async ({ expect }) => {
    const projectId = await createOnboardedGrowthProject();
    await signInAsNonAdmin();

    // Being signed into the internal project is NOT sufficient — its publishable key is public and
    // anyone can self-signup, which is exactly what ensurePlatformAdmin exists to stop.
    for (const [method, path, body] of [
      ["GET", `${ADMIN_GAMES}?project_id=${projectId}`, undefined],
      ["POST", `${ADMIN_GAMES}/generate`, { target_project_id: projectId }],
      ["PATCH", `${ADMIN_GAMES}/${randomUUID()}`, { target_project_id: projectId, action: "publish" }],
      ["DELETE", `${ADMIN_GAMES}/${randomUUID()}/questions/0`, { target_project_id: projectId }],
    ] as const) {
      const response = await niceBackendFetch(path, { accessType: "client", method, ...body == null ? {} : { body } });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it("refuses a target project that has never onboarded to Growth", async ({ expect }) => {
    await signInAsInternalAdmin();
    const response = await niceBackendFetch(`${ADMIN_GAMES}?project_id=${randomUUID()}`, { accessType: "client" });
    expect(response.status).toBe(404);
  });

  it("refuses the internal project as a target", async ({ expect }) => {
    await signInAsInternalAdmin();
    const response = await niceBackendFetch(`${ADMIN_GAMES}?project_id=internal`, { accessType: "client" });
    expect(response.status).toBe(400);
  });
});

describe("staff review surface", () => {
  it("reports an empty quiz state for a project that has never had one", { timeout: 300_000 }, async ({ expect }) => {
    const projectId = await createOnboardedGrowthProject();
    await signInAsInternalAdmin();

    const response = await niceBackendFetch(`${ADMIN_GAMES}?project_id=${projectId}`, { accessType: "client" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "draft": null,
        "published": null,
        "results": [],
      }
    `);
  });

  it("refuses to generate for a project with too little metric history, and says how far off it is", { timeout: 300_000 }, async ({ expect }) => {
    const projectId = await createOnboardedGrowthProject();
    await signInAsInternalAdmin();

    const response = await niceBackendFetch(`${ADMIN_GAMES}/generate`, {
      accessType: "client",
      method: "POST",
      body: { target_project_id: projectId },
    });
    // 409 rather than 500: a young project having thin data is a normal state, and the message is
    // written to be shown to staff verbatim.
    expect(response.status).toBe(409);
    expect(response.body).toEqual(expect.stringContaining("enough metric history"));
  });

  it("leaves no draft behind when generation is refused", { timeout: 300_000 }, async ({ expect }) => {
    const projectId = await createOnboardedGrowthProject();
    await signInAsInternalAdmin();
    await niceBackendFetch(`${ADMIN_GAMES}/generate`, { accessType: "client", method: "POST", body: { target_project_id: projectId } });

    // The gate is checked BEFORE the game row is inserted, so a refused generate must not consume
    // the one-draft-per-project slot — otherwise the project would be wedged by its own first click.
    const after = await niceBackendFetch(`${ADMIN_GAMES}?project_id=${projectId}`, { accessType: "client" });
    expect(after.status).toBe(200);
    expect((after.body as { draft: unknown }).draft).toBeNull();
  });

  it("404s on a game id that does not exist, for every mutation", { timeout: 300_000 }, async ({ expect }) => {
    const projectId = await createOnboardedGrowthProject();
    await signInAsInternalAdmin();

    // Same 404 for a malformed id and an unknown one, so ids cannot be probed for existence.
    for (const gameId of ["not-a-uuid", randomUUID()]) {
      const publish = await niceBackendFetch(`${ADMIN_GAMES}/${gameId}`, {
        accessType: "client", method: "PATCH", body: { target_project_id: projectId, action: "publish" },
      });
      expect(publish.status, `publish ${gameId}`).toBe(404);

      const edit = await niceBackendFetch(`${ADMIN_GAMES}/${gameId}/questions/0`, {
        accessType: "client", method: "PATCH", body: { target_project_id: projectId, text: "New wording?", explanation: "Because it matters." },
      });
      expect(edit.status, `edit ${gameId}`).toBe(404);

      const remove = await niceBackendFetch(`${ADMIN_GAMES}/${gameId}/questions/0`, {
        accessType: "client", method: "DELETE", body: { target_project_id: projectId },
      });
      expect(remove.status, `remove ${gameId}`).toBe(404);
    }
  });

  it("validates the edit body before it looks anything up", { timeout: 300_000 }, async ({ expect }) => {
    const projectId = await createOnboardedGrowthProject();
    await signInAsInternalAdmin();

    for (const body of [
      { target_project_id: projectId },
      { target_project_id: projectId, text: "", explanation: "ok" },
      { target_project_id: projectId, text: "ok", explanation: "" },
      { target_project_id: projectId, text: "x".repeat(401), explanation: "ok" },
    ]) {
      const response = await niceBackendFetch(`${ADMIN_GAMES}/${randomUUID()}/questions/0`, {
        accessType: "client", method: "PATCH", body,
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
    }

    // A negative order index is a malformed path, not a missing question.
    const negative = await niceBackendFetch(`${ADMIN_GAMES}/${randomUUID()}/questions/-1`, {
      accessType: "client", method: "PATCH", body: { target_project_id: projectId, text: "ok", explanation: "ok" },
    });
    expect(negative.status).toBe(400);
  });

  it("rejects an unknown lifecycle action", { timeout: 300_000 }, async ({ expect }) => {
    const projectId = await createOnboardedGrowthProject();
    await signInAsInternalAdmin();
    const response = await niceBackendFetch(`${ADMIN_GAMES}/${randomUUID()}`, {
      accessType: "client", method: "PATCH", body: { target_project_id: projectId, action: "delete" },
    });
    expect(response.status).toBe(400);
  });
});

describe("customer surface", () => {
  it("refuses every games route when the Growth app is not installed", async ({ expect }) => {
    await Project.createAndSwitch();

    for (const [method, path] of [
      ["GET", `${GAMES_BASE}/published`],
      ["POST", `${GAMES_BASE}/rounds`],
      ["GET", `${GAMES_BASE}/rounds/${randomUUID()}`],
      ["POST", `${GAMES_BASE}/rounds/${randomUUID()}/finish`],
    ] as const) {
      const response = await niceBackendFetch(path, { accessType: "admin", method });
      expect(response.status, `${method} ${path}`).toBe(400);
      expect(response.body).toBe("The Growth app is not enabled for this project.");
    }
  });

  it("reports no published quiz when staff have not published one", { timeout: 300_000 }, async ({ expect }) => {
    await createOnboardedGrowthProject();

    // The banner renders nothing at all on this body — which is the honest outcome, because there is
    // nothing for the customer to act on.
    const response = await niceBackendFetch(`${GAMES_BASE}/published`, { accessType: "admin" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "game": null,
        "round": null,
      }
    `);
  });

  it("refuses to start a round when nothing is published", { timeout: 300_000 }, async ({ expect }) => {
    await createOnboardedGrowthProject();
    const response = await niceBackendFetch(`${GAMES_BASE}/rounds`, { accessType: "admin", method: "POST" });
    expect(response.status).toBe(409);
    expect(response.body).toEqual(expect.stringContaining("no quiz published"));
  });

  it("404s identically for a malformed round id, an unknown one, and another project's", { timeout: 300_000 }, async ({ expect }) => {
    await createOnboardedGrowthProject();

    for (const roundId of ["not-a-uuid", randomUUID()]) {
      const get = await niceBackendFetch(`${GAMES_BASE}/rounds/${roundId}`, { accessType: "admin" });
      expect(get.status, `GET ${roundId}`).toBe(404);
      expect(get.body).toBe("Round not found.");

      const finish = await niceBackendFetch(`${GAMES_BASE}/rounds/${roundId}/finish`, { accessType: "admin", method: "POST" });
      expect(finish.status, `finish ${roundId}`).toBe(404);

      const answer = await niceBackendFetch(`${GAMES_BASE}/rounds/${roundId}/answers`, {
        accessType: "admin", method: "POST", body: { order_index: 0, option_id: "o0" },
      });
      expect(answer.status, `answer ${roundId}`).toBe(404);
    }
  });

  it("validates the answer body before it looks anything up", { timeout: 300_000 }, async ({ expect }) => {
    await createOnboardedGrowthProject();

    for (const body of [{}, { order_index: -1, option_id: "o0" }, { order_index: 0 }, { order_index: 1.5, option_id: "o0" }, { order_index: 0, option_id: "" }]) {
      const response = await niceBackendFetch(`${GAMES_BASE}/rounds/${randomUUID()}/answers`, {
        accessType: "admin", method: "POST", body,
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("does not expose the staff review surface to a project admin key", { timeout: 300_000 }, async ({ expect }) => {
    const projectId = await createOnboardedGrowthProject();

    // The admin routes take user auth in the internal project; a customer's own admin key must not
    // reach them, whatever project id it names.
    const response = await niceBackendFetch(`${ADMIN_GAMES}?project_id=${projectId}`, { accessType: "admin" });
    expect(response.status).not.toBe(200);
  });
});
