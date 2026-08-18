import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../../backend-helpers";
import { createGrowthProject } from "./growth-helpers";

const ADMIN_BASE = "/api/latest/internal/growth";

// Growth fixtures seed sandbox-backed workflows during onboarding and can land around 60s under
// full-suite load, so default-timeout tests need 90s of headroom.

// Milestones return server-generated ids and clock-dependent timestamps, so most assertions use
// toMatchObject (deliberate deviation from the usual snapshot preference); fully deterministic
// bodies (delete ack) are snapshotted. (Scheduled tasks were replaced by customer workflows in the
// workflows-engine migration — their automation lifecycle is covered by action-workflows.test.ts.)

async function createOnboardedGrowthProject() {
  const projectKeys = await createGrowthProject();
  if (projectKeys === "no-project") {
    throw new Error("createGrowthProject should have switched the context to a fresh project.");
  }
  const onboarding = await niceBackendFetch(`${ADMIN_BASE}/onboarding`, {
    accessType: "admin",
    method: "POST",
    body: { website_url: "https://plannery.example.com", company_summary: "Project management for small teams." },
  });
  if (onboarding.status !== 200) {
    throw new Error(`Growth onboarding failed with status ${onboarding.status}.`);
  }
  // Tests always run against the default branch.
  return { projectId: projectKeys.projectId, branchId: "main" };
}

function requireItems(body: unknown): Record<string, unknown>[] {
  if (typeof body !== "object" || body == null || !("items" in body) || !Array.isArray(body.items)) {
    throw new Error("Expected the growth response to contain an items array.");
  }
  return body.items as Record<string, unknown>[]; // e2e assertion helper — the item shapes are asserted by the tests themselves right after
}

function requireId(body: unknown): string {
  if (typeof body !== "object" || body == null || !("id" in body) || typeof body.id !== "string") {
    throw new Error("Expected the growth response to contain an id string.");
  }
  return body.id;
}

describe("internal growth milestones", { timeout: 90_000 }, () => {
  it("seeds the default total_users ladder exactly once on onboarding", async ({ expect }) => {
    await createOnboardedGrowthProject();

    const list = await niceBackendFetch(`${ADMIN_BASE}/milestones`, { accessType: "admin" });
    expect(list.status).toBe(200);
    const items = requireItems(list.body);
    expect(items).toHaveLength(3);
    // Seeded rows share a createdAt (createMany), so list order can tie-break arbitrarily by id —
    // sort by threshold before pinning the ladder.
    const sorted = [...items].sort((a, b) => (a.threshold as number) - (b.threshold as number));
    expect(sorted).toMatchObject([
      { metric_id: "total_users", comparator: "gte", threshold: 10, source: "default", status: "armed" },
      { metric_id: "total_users", comparator: "gte", threshold: 100, source: "default", status: "armed" },
      { metric_id: "total_users", comparator: "gte", threshold: 1000, source: "default", status: "armed" },
    ]);

    // Onboarding is once per branch; the failed retry must not re-seed. (The crash-between-writes
    // retry path is atomic by construction — seeding happens in the onboarding transaction — and the
    // skip-if-any-rows-exist rule is unit-covered in lib/growth/milestones.test.ts.)
    const retry = await niceBackendFetch(`${ADMIN_BASE}/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://plannery.example.com" },
    });
    expect(retry.status).toBe(400);
    const listAfterRetry = await niceBackendFetch(`${ADMIN_BASE}/milestones`, { accessType: "admin" });
    expect(requireItems(listAfterRetry.body)).toHaveLength(3);
  });

  it("supports the user milestone create/patch/delete lifecycle", async ({ expect }) => {
    await createOnboardedGrowthProject();

    const created = await niceBackendFetch(`${ADMIN_BASE}/milestones`, {
      accessType: "admin",
      method: "POST",
      body: { metric_id: "revenue", threshold: 500 },
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      metric_id: "revenue",
      comparator: "gte",
      threshold: 500,
      source: "user",
      status: "armed",
    });
    const milestoneId = requireId(created.body);

    const disabled = await niceBackendFetch(`${ADMIN_BASE}/milestones/${milestoneId}`, {
      accessType: "admin",
      method: "PATCH",
      body: { status: "disabled" },
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body).toMatchObject({ id: milestoneId, status: "disabled" });

    // PATCH without a status is a read-back of the current item.
    const readBack = await niceBackendFetch(`${ADMIN_BASE}/milestones/${milestoneId}`, {
      accessType: "admin",
      method: "PATCH",
      body: {},
    });
    expect(readBack.status).toBe(200);
    expect(readBack.body).toMatchObject({ id: milestoneId, status: "disabled" });

    const rearmed = await niceBackendFetch(`${ADMIN_BASE}/milestones/${milestoneId}`, {
      accessType: "admin",
      method: "PATCH",
      body: { status: "armed" },
    });
    expect(rearmed.status).toBe(200);
    expect(rearmed.body).toMatchObject({ id: milestoneId, status: "armed" });

    // "reached" is engine-owned and cannot be set by users.
    const reached = await niceBackendFetch(`${ADMIN_BASE}/milestones/${milestoneId}`, {
      accessType: "admin",
      method: "PATCH",
      body: { status: "reached" },
    });
    expect(reached.status).toBe(400);

    const deleted = await niceBackendFetch(`${ADMIN_BASE}/milestones/${milestoneId}`, {
      accessType: "admin",
      method: "DELETE",
    });
    expect(deleted).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "status": "deleted" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const listAfterDelete = await niceBackendFetch(`${ADMIN_BASE}/milestones`, { accessType: "admin" });
    expect(requireItems(listAfterDelete.body).map((item) => item.id)).not.toContain(milestoneId);

    const deleteAgain = await niceBackendFetch(`${ADMIN_BASE}/milestones/${milestoneId}`, {
      accessType: "admin",
      method: "DELETE",
    });
    expect(deleteAgain.status).toBe(404);
    const patchAfterDelete = await niceBackendFetch(`${ADMIN_BASE}/milestones/${milestoneId}`, {
      accessType: "admin",
      method: "PATCH",
      body: { status: "disabled" },
    });
    expect(patchAfterDelete.status).toBe(404);
  });

  it("rejects invalid creates and cross-project access", async ({ expect }) => {
    await createOnboardedGrowthProject();

    const badMetric = await niceBackendFetch(`${ADMIN_BASE}/milestones`, {
      accessType: "admin",
      method: "POST",
      body: { metric_id: "nonsense", threshold: 5 },
    });
    expect(badMetric.status).toBe(400);

    const zeroThreshold = await niceBackendFetch(`${ADMIN_BASE}/milestones`, {
      accessType: "admin",
      method: "POST",
      body: { metric_id: "total_users", threshold: 0 },
    });
    expect(zeroThreshold.status).toBe(400);

    const negativeThreshold = await niceBackendFetch(`${ADMIN_BASE}/milestones`, {
      accessType: "admin",
      method: "POST",
      body: { metric_id: "total_users", threshold: -5 },
    });
    expect(negativeThreshold.status).toBe(400);

    const created = await niceBackendFetch(`${ADMIN_BASE}/milestones`, {
      accessType: "admin",
      method: "POST",
      body: { metric_id: "total_users", threshold: 5000 },
    });
    expect(created.status).toBe(200);
    const foreignMilestoneId = requireId(created.body);

    // A different project's admin key must see foreign milestone ids as plain 404s.
    await createOnboardedGrowthProject();
    const foreignPatch = await niceBackendFetch(`${ADMIN_BASE}/milestones/${foreignMilestoneId}`, {
      accessType: "admin",
      method: "PATCH",
      body: { status: "disabled" },
    });
    expect(foreignPatch.status).toBe(404);
    const foreignDelete = await niceBackendFetch(`${ADMIN_BASE}/milestones/${foreignMilestoneId}`, {
      accessType: "admin",
      method: "DELETE",
    });
    expect(foreignDelete.status).toBe(404);
    const missing = await niceBackendFetch(`${ADMIN_BASE}/milestones/${randomUUID()}`, {
      accessType: "admin",
      method: "DELETE",
    });
    expect(missing.status).toBe(404);
  });

  it("rejects non-admin access and projects without the app", async ({ expect }) => {
    await Project.createAndSwitch();
    const disabledApp = await niceBackendFetch(`${ADMIN_BASE}/milestones`, { accessType: "admin" });
    expect(disabledApp.status).toBe(400);

    await Project.updateConfig({ "apps.installed.gtm.enabled": true });
    const clientAccess = await niceBackendFetch(`${ADMIN_BASE}/milestones`, { accessType: "client" });
    expect(clientAccess.status).toBe(401);
  });
});
