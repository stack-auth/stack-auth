import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Auth, InternalProjectKeys, Project, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

const BASE_PATH = "/api/latest/internal/gtm";

function requireId(body: unknown): string {
  if (typeof body !== "object" || body == null || !("id" in body) || typeof body.id !== "string") {
    throw new Error("Expected the GTM response to contain a string ID.");
  }
  return body.id;
}

function requireUpdatedAt(body: unknown): number {
  if (typeof body !== "object" || body == null || !("updated_at_millis" in body) || typeof body.updated_at_millis !== "number") {
    throw new Error("Expected the GTM response to contain an updated_at_millis number.");
  }
  return body.updated_at_millis;
}

async function signInAsInternalAdmin(): Promise<void> {
  backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
  await Auth.fastSignUp();
}

describe("internal GTM dashboard content", () => {
  it("rejects unauthenticated and customer-project requests", async ({ expect }) => {
    backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
    const unauthenticated = await niceBackendFetch(`${BASE_PATH}/insights`, { accessType: "client" });
    expect(unauthenticated.status).toBe(401);
    const unauthenticatedOnboarding = await niceBackendFetch(`${BASE_PATH}/onboarding`, { accessType: "client" });
    expect(unauthenticatedOnboarding.status).toBe(401);
    const unauthenticatedProjects = await niceBackendFetch(`${BASE_PATH}/onboarding/projects`, { accessType: "client" });
    expect(unauthenticatedProjects.status).toBe(401);

    await Project.createAndSwitch();
    await Auth.fastSignUp();
    const customerProject = await niceBackendFetch(`${BASE_PATH}/insights`, { accessType: "client" });
    expect(customerProject.status).toBe(400);
    const customerOnboarding = await niceBackendFetch(`${BASE_PATH}/onboarding`, { accessType: "client" });
    expect(customerOnboarding.status).toBe(400);
    const customerProjects = await niceBackendFetch(`${BASE_PATH}/onboarding/projects`, { accessType: "client" });
    expect(customerProjects.status).toBe(400);

    const customerUserAuth = backendContext.value.userAuth;
    backendContext.set({ projectKeys: InternalProjectKeys, userAuth: customerUserAuth });
    const nonPlatformAdmin = await niceBackendFetch(`${BASE_PATH}/insights`, { accessType: "client" });
    expect([401, 403]).toContain(nonPlatformAdmin.status);
    const nonPlatformAdminOnboarding = await niceBackendFetch(`${BASE_PATH}/onboarding`, { accessType: "client" });
    expect([401, 403]).toContain(nonPlatformAdminOnboarding.status);
    const nonPlatformAdminProjects = await niceBackendFetch(`${BASE_PATH}/onboarding/projects`, { accessType: "client" });
    expect([401, 403]).toContain(nonPlatformAdminProjects.status);
  });

  it("persists and updates the GTM intake details", async ({ expect }) => {
    await signInAsInternalAdmin();

    const before = await niceBackendFetch(`${BASE_PATH}/onboarding`, { accessType: "client" });
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ completed: expect.any(Boolean) });
    expect(before.body).not.toHaveProperty("details");

    const clientDetails = await niceBackendFetch(`${BASE_PATH}/onboarding/details`, { accessType: "client" });
    expect([401, 403]).toContain(clientDetails.status);

    const invalid = await niceBackendFetch(`${BASE_PATH}/onboarding/details`, {
      accessType: "admin",
      method: "POST",
      body: { domain: "not a website", phone: "123", notes: "x".repeat(2001) },
    });
    expect(invalid.status).toBe(400);

    const completed = await niceBackendFetch(`${BASE_PATH}/onboarding/details`, {
      accessType: "admin",
      method: "POST",
      body: {
        domain: "https://www.example.com/pricing",
        phone: "+1 (415) 555-0100",
        notes: "We want to improve activation and understand our best acquisition channels.",
      },
    });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      completed: true,
      details: {
        domain: "www.example.com",
        phone: "+1 (415) 555-0100",
        notes: "We want to improve activation and understand our best acquisition channels.",
      },
    });

    const updated = await niceBackendFetch(`${BASE_PATH}/onboarding/details`, {
      accessType: "admin",
      method: "POST",
      body: {
        domain: "https://www.example.com",
        phone: "+1 (415) 555-0101",
        notes: "Activation is still the priority, and the pricing launch is next.",
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      completed: true,
      details: {
        domain: "www.example.com",
        phone: "+1 (415) 555-0101",
        notes: "Activation is still the priority, and the pricing launch is next.",
      },
    });

    const afterStatus = await niceBackendFetch(`${BASE_PATH}/onboarding`, { accessType: "client" });
    expect(afterStatus.status).toBe(200);
    expect(afterStatus.body).toMatchObject({ completed: true });
    expect(afterStatus.body).not.toHaveProperty("details");

    const after = await niceBackendFetch(`${BASE_PATH}/onboarding/details`, { accessType: "admin" });
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({
      completed: true,
      details: {
        domain: "www.example.com",
        phone: "+1 (415) 555-0101",
        notes: "Activation is still the priority, and the pricing launch is next.",
      },
    });
  });

  it("reads a project's own onboarding status with an admin key and no user", async ({ expect }) => {
    // This is exactly how the project dashboard reads the gate: its owned-project app is constructed with
    // `tokenStore === null`, so it can never send an access token and `auth.user` is structurally null.
    // Requiring a user here used to 401 every project dashboard with USER_AUTHENTICATION_REQUIRED.
    await Project.createAndSwitch({ display_name: "Admin key onboarding read" });

    const beforeIntake = await niceBackendFetch(`${BASE_PATH}/onboarding`, { accessType: "admin" });
    expect(beforeIntake.status).toBe(200);
    expect(beforeIntake.body).toMatchObject({ completed: false, completed_at_millis: null });

    // A client key alone stays rejected — it is public, so possession of it must not grant GTM reads.
    const clientWithoutUser = await niceBackendFetch(`${BASE_PATH}/onboarding`, { accessType: "client" });
    expect(clientWithoutUser.status).toBe(401);

    const completed = await niceBackendFetch(`${BASE_PATH}/onboarding/details`, {
      accessType: "admin",
      method: "POST",
      body: { domain: "https://admin-key.example.com", phone: "+1 415 555 0199", notes: "Read back via admin key." },
    });
    expect(completed.status).toBe(200);

    const afterIntake = await niceBackendFetch(`${BASE_PATH}/onboarding`, { accessType: "admin" });
    expect(afterIntake.status).toBe(200);
    expect(afterIntake.body).toMatchObject({ completed: true });
    expect(afterIntake.body).not.toHaveProperty("details");
  });

  it("stores, replaces, and clears a curated suggestion timeline", async ({ expect }) => {
    await signInAsInternalAdmin();

    const created = await niceBackendFetch(`${BASE_PATH}/insights`, {
      accessType: "client",
      method: "POST",
      body: {
        domain: "product",
        title: "Curated timeline signal",
        body: "The timeline for this one is written by hand.",
        impact_score: 10,
        times_seen: 1,
      },
    });
    expect(created.status).toBe(201);
    // A suggestion nobody has curated reads back as null, which the dashboard renders as an empty timeline.
    expect(created.body.timeline_entries).toBe(null);

    const insightId = requireId(created.body);
    const withTimeline = await niceBackendFetch(`${BASE_PATH}/insights/${insightId}`, {
      accessType: "client",
      method: "PATCH",
      body: {
        expected_updated_at_millis: requireUpdatedAt(created.body),
        domain: "product",
        title: "Curated timeline signal",
        body: "The timeline for this one is written by hand.",
        impact_score: 10,
        times_seen: 1,
        timeline_entries: [
          { label: "  Kickoff  ", title: "  We met the team  ", body: "  Discussed the launch.  ", date_millis: 1_700_000_000_000 },
          { label: "Now", title: "Waiting on data", body: "", date_millis: 1_700_100_000_000 },
        ],
      },
    });
    expect(withTimeline.status).toBe(200);
    // Whitespace is trimmed on the way in so the rendered timeline never shows padded text.
    expect(withTimeline.body.timeline_entries).toEqual([
      { label: "Kickoff", title: "We met the team", body: "Discussed the launch.", date_millis: 1_700_000_000_000 },
      { label: "Now", title: "Waiting on data", body: "", date_millis: 1_700_100_000_000 },
    ]);

    const listed = await niceBackendFetch(`${BASE_PATH}/insights`, { accessType: "client" });
    expect(listed.status).toBe(200);
    const listedInsight = listed.body.items.find((item: { id: string }) => item.id === insightId);
    expect(listedInsight.timeline_entries).toHaveLength(2);

    // An empty array is a real curated state ("show nothing"), distinct from null, and must survive a round trip.
    const emptied = await niceBackendFetch(`${BASE_PATH}/insights/${insightId}`, {
      accessType: "client",
      method: "PATCH",
      body: {
        expected_updated_at_millis: requireUpdatedAt(withTimeline.body),
        domain: "product",
        title: "Curated timeline signal",
        body: "The timeline for this one is written by hand.",
        impact_score: 10,
        times_seen: 1,
        timeline_entries: [],
      },
    });
    expect(emptied.status).toBe(200);
    expect(emptied.body.timeline_entries).toEqual([]);

    // Explicit null clears the timeline back to "nothing written yet".
    const cleared = await niceBackendFetch(`${BASE_PATH}/insights/${insightId}`, {
      accessType: "client",
      method: "PATCH",
      body: {
        expected_updated_at_millis: requireUpdatedAt(emptied.body),
        domain: "product",
        title: "Curated timeline signal",
        body: "The timeline for this one is written by hand.",
        impact_score: 10,
        times_seen: 1,
        timeline_entries: null,
      },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.timeline_entries).toBe(null);

    const blankLabel = await niceBackendFetch(`${BASE_PATH}/insights/${insightId}`, {
      accessType: "client",
      method: "PATCH",
      body: {
        expected_updated_at_millis: requireUpdatedAt(cleared.body),
        domain: "product",
        title: "Curated timeline signal",
        body: "The timeline for this one is written by hand.",
        impact_score: 10,
        times_seen: 1,
        timeline_entries: [{ label: "   ", title: "Missing its label", body: "", date_millis: 1_700_000_000_000 }],
      },
    });
    expect(blankLabel.status).toBe(400);
  });

  it("stores a curated timeline on an action too", async ({ expect }) => {
    await signInAsInternalAdmin();
    const expiresAt = new Date("2030-06-01T00:00:00.000Z").getTime();

    const created = await niceBackendFetch(`${BASE_PATH}/actions`, {
      accessType: "client",
      method: "POST",
      body: {
        domain: "outreach",
        type: "broadcast_email",
        status: "proposed",
        title: "Curated action",
        summary: "Planning record only.",
        verdict: null,
        retrospective_text: null,
        expires_at_millis: expiresAt,
        executed_at_millis: null,
        timeline_entries: [
          { label: "Drafted", title: "We wrote the plan", body: "Ready for review.", date_millis: 1_700_000_000_000 },
        ],
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.timeline_entries).toEqual([
      { label: "Drafted", title: "We wrote the plan", body: "Ready for review.", date_millis: 1_700_000_000_000 },
    ]);

    const actionId = requireId(created.body);
    const cleared = await niceBackendFetch(`${BASE_PATH}/actions/${actionId}`, {
      accessType: "client",
      method: "PATCH",
      body: {
        expected_updated_at_millis: requireUpdatedAt(created.body),
        domain: "outreach",
        type: "broadcast_email",
        status: "proposed",
        title: "Curated action",
        summary: "Planning record only.",
        verdict: null,
        retrospective_text: null,
        expires_at_millis: expiresAt,
        executed_at_millis: null,
        timeline_entries: null,
      },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.timeline_entries).toBe(null);
  });

  it("lists only customer projects that completed GTM onboarding", async ({ expect }) => {
    const notOnboardedProject = await Project.createAndSwitch({ display_name: "Not onboarded" });
    const onboardedProject = await Project.createAndSwitch({ display_name: "Acme GTM" });
    const completed = await niceBackendFetch(`${BASE_PATH}/onboarding/details`, {
      accessType: "admin",
      method: "POST",
      body: {
        domain: "https://acme.example.com",
        phone: "+1 415 555 0100",
        notes: "Ready for GTM.",
      },
    });
    expect(completed.status).toBe(200);

    await signInAsInternalAdmin();
    const listed = await niceBackendFetch(`${BASE_PATH}/onboarding/projects`, { accessType: "client" });
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      items: [{
        id: onboardedProject.projectId,
        display_name: "Acme GTM",
        completed_at_millis: expect.any(Number),
        details: {
          domain: "acme.example.com",
          phone: "+1 415 555 0100",
          notes: "Ready for GTM.",
        },
      }],
    });
    expect(listed.body.items).not.toContainEqual(expect.objectContaining({ id: notOnboardedProject.projectId }));
    expect(listed.body.items).not.toContainEqual(expect.objectContaining({ id: "internal" }));
  });

  it("creates, orders, updates, conflict-checks, and deletes every resource without executing actions", async ({ expect }) => {
    await signInAsInternalAdmin();
    const expiresAt = new Date("2030-01-01T00:00:00.000Z").getTime();

    const insight = await niceBackendFetch(`${BASE_PATH}/insights`, {
      accessType: "client",
      method: "POST",
      body: {
        domain: "users",
        title: "Retention is improving",
        body: "Activated developers return more frequently.",
        impact_score: 82,
        times_seen: 3,
      },
    });
    expect(insight.status).toBe(201);
    expect(insight.body).toMatchObject({
      domain: "users",
      impact_score: 82,
      times_seen: 3,
    });

    const action = await niceBackendFetch(`${BASE_PATH}/actions`, {
      accessType: "client",
      method: "POST",
      body: {
        domain: "outreach",
        type: "broadcast_email",
        status: "proposed",
        title: "Invite activated developers",
        summary: "This is a planning record only.",
        verdict: null,
        retrospective_text: null,
        expires_at_millis: expiresAt,
        executed_at_millis: null,
      },
    });
    expect(action.status).toBe(201);
    expect(action.body).toMatchObject({
      domain: "outreach",
      status: "proposed",
      executed_at_millis: null,
      verdict: null,
    });

    const firstNote = await niceBackendFetch(`${BASE_PATH}/notes`, {
      accessType: "client",
      method: "POST",
      body: { title: "Developer product", domain: "product", category: "company", body: "The product is built for developers.", source: "user" },
    });
    const secondNote = await niceBackendFetch(`${BASE_PATH}/notes`, {
      accessType: "client",
      method: "POST",
      body: { title: "Content strategy", domain: "content", category: "strategy", body: "Lead with implementation speed.", source: "user" },
    });
    expect(firstNote.status).toBe(201);
    expect(secondNote.status).toBe(201);

    const listedNotes = await niceBackendFetch(`${BASE_PATH}/notes`, { accessType: "client" });
    expect(listedNotes.status).toBe(200);
    expect(listedNotes.body.items.slice(0, 2).map((note: { id: string }) => note.id)).toEqual([
      requireId(secondNote.body),
      requireId(firstNote.body),
    ]);

    const insightId = requireId(insight.body);
    const insightUpdatedAt = requireUpdatedAt(insight.body);
    const updatedInsight = await niceBackendFetch(`${BASE_PATH}/insights/${insightId}`, {
      accessType: "client",
      method: "PATCH",
      body: {
        expected_updated_at_millis: insightUpdatedAt,
        domain: "content",
        title: "Retention is improving",
        body: "Activated developers return more frequently after setup.",
        impact_score: 88,
        times_seen: 4,
      },
    });
    expect(updatedInsight.status).toBe(200);
    expect(updatedInsight.body).toMatchObject({ domain: "content" });
    expect(requireUpdatedAt(updatedInsight.body)).toBeGreaterThan(insightUpdatedAt);

    const staleInsight = await niceBackendFetch(`${BASE_PATH}/insights/${insightId}`, {
      accessType: "client",
      method: "PATCH",
      body: {
        expected_updated_at_millis: insightUpdatedAt,
        domain: "users",
        title: "Stale overwrite",
        body: "This edit should not win.",
        impact_score: 1,
        times_seen: 1,
      },
    });
    expect(staleInsight.status).toBe(409);

    const staleDelete = await niceBackendFetch(`${BASE_PATH}/insights/${insightId}`, {
      accessType: "client",
      method: "DELETE",
      body: { expected_updated_at_millis: insightUpdatedAt },
    });
    expect(staleDelete.status).toBe(409);

    const actionId = requireId(action.body);
    const updatedAction = await niceBackendFetch(`${BASE_PATH}/actions/${actionId}`, {
      accessType: "client",
      method: "PATCH",
      body: {
        expected_updated_at_millis: requireUpdatedAt(action.body),
        domain: "revenue",
        type: "broadcast_email",
        status: "approved",
        title: "Invite activated developers",
        summary: "Approval changes only this inert record.",
        verdict: null,
        retrospective_text: null,
        expires_at_millis: expiresAt,
        executed_at_millis: null,
      },
    });
    expect(updatedAction.status).toBe(200);
    expect(updatedAction.body).toMatchObject({ domain: "revenue", status: "approved", executed_at_millis: null });

    const noteId = requireId(firstNote.body);
    const updatedNote = await niceBackendFetch(`${BASE_PATH}/notes/${noteId}`, {
      accessType: "client",
      method: "PATCH",
      body: {
        expected_updated_at_millis: requireUpdatedAt(firstNote.body),
        title: "Primary audience",
        domain: "users",
        category: "audience",
        body: "The primary audience is application developers.",
        source: "user",
      },
    });
    expect(updatedNote.status).toBe(200);
    expect(updatedNote.body).toMatchObject({ title: "Primary audience", domain: "users", category: "audience" });

    const deletions = await Promise.all([
      niceBackendFetch(`${BASE_PATH}/insights/${insightId}`, {
        accessType: "client",
        method: "DELETE",
        body: { expected_updated_at_millis: requireUpdatedAt(updatedInsight.body) },
      }),
      niceBackendFetch(`${BASE_PATH}/actions/${actionId}`, {
        accessType: "client",
        method: "DELETE",
        body: { expected_updated_at_millis: requireUpdatedAt(updatedAction.body) },
      }),
      niceBackendFetch(`${BASE_PATH}/notes/${noteId}`, {
        accessType: "client",
        method: "DELETE",
        body: { expected_updated_at_millis: requireUpdatedAt(updatedNote.body) },
      }),
    ]);
    expect(deletions.map((response) => response.status)).toEqual([200, 200, 200]);

    const missing = await niceBackendFetch(`${BASE_PATH}/notes/${randomUUID()}`, {
      accessType: "client",
      method: "DELETE",
      body: { expected_updated_at_millis: requireUpdatedAt(secondNote.body) },
    });
    expect(missing.status).toBe(404);
  });

  it("validates enums, lengths, scores, and paginates recent-first", async ({ expect }) => {
    await signInAsInternalAdmin();

    const invalidInsight = await niceBackendFetch(`${BASE_PATH}/insights`, {
      accessType: "client",
      method: "POST",
      body: {
        domain: "users",
        title: "",
        body: "Invalid",
        impact_score: 101,
      },
    });
    expect(invalidInsight.status).toBe(400);

    const invalidAction = await niceBackendFetch(`${BASE_PATH}/actions`, {
      accessType: "client",
      method: "POST",
      body: {
        domain: "revenue",
        type: "send_money",
        status: "executed",
        title: "Invalid",
        summary: "Invalid action type.",
        expires_at_millis: new Date("2030-01-01T00:00:00.000Z").getTime(),
      },
    });
    expect(invalidAction.status).toBe(400);

    const invalidNote = await niceBackendFetch(`${BASE_PATH}/notes`, {
      accessType: "client",
      method: "POST",
      body: { title: "Invalid note", domain: "product", category: "company", body: "x".repeat(501), source: "user" },
    });
    expect(invalidNote.status).toBe(400);

    const invalidNoteTitle = await niceBackendFetch(`${BASE_PATH}/notes`, {
      accessType: "client",
      method: "POST",
      body: { title: "x".repeat(121), domain: "product", category: "company", body: "Valid note body.", source: "user" },
    });
    expect(invalidNoteTitle.status).toBe(400);

    const invalidDomain = await niceBackendFetch(`${BASE_PATH}/notes`, {
      accessType: "client",
      method: "POST",
      body: { title: "Invalid domain", domain: "made_up", category: "company", body: "Invalid domain.", source: "user" },
    });
    expect(invalidDomain.status).toBe(400);

    const createdIds: string[] = [];
    for (let index = 0; index < 101; index++) {
      const response = await niceBackendFetch(`${BASE_PATH}/notes`, {
        accessType: "client",
        method: "POST",
        body: { title: `Pagination note ${index}`, domain: "content", category: "learning", body: `Pagination note ${index}`, source: "user" },
      });
      expect(response.status).toBe(201);
      createdIds.push(requireId(response.body));
    }

    const firstPage = await niceBackendFetch(`${BASE_PATH}/notes`, { accessType: "client" });
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(100);
    expect(firstPage.body.items[0].id).toBe(createdIds.at(-1));
    expect(firstPage.body.next_cursor).toEqual(expect.any(String));

    const secondPage = await niceBackendFetch(`${BASE_PATH}/notes?cursor=${encodeURIComponent(firstPage.body.next_cursor)}`, {
      accessType: "client",
    });
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items.length).toBeGreaterThan(0);
    expect(secondPage.body.next_cursor).toBeNull();
  });
});
