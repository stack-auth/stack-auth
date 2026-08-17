import { describe, expect } from "vitest";
import { it } from "../../../../../../helpers";
import { niceBackendFetch } from "../../../../../backend-helpers";
import { createGrowthProject } from "../growth/growth-helpers";

const BASE = "/api/latest/internal/growth-server";

/**
 * `internal/growth-server/**` runs under ORDINARY server auth (accessType: "server" below) — any
 * holder of the project's own server API key, not the shared growth-agent secret. In practice that's
 * a customer's own scheduled Workflow calling in via an HTTP action node. These tests exercise the
 * constraints that make that trust boundary safe: `findings` forces `source` to the caller's own
 * `workflow_id` rather than trusting the body, and `action-items` is pinned to `type_id: "custom"`, has no
 * `workflow` field at all, and requires (and honors) `dedupe_key` so a daily monitor can't flood the
 * actions list with one new item per run.
 */

describe("growth-server/findings", () => {
  it("forces source to the caller's workflow_id and dedupes repeated (source, kind, title)", async ({ expect }) => {
    await createGrowthProject();
    const body = {
      workflow_id: "customer-workflow-cpa-monitor",
      findings: [{ kind: "metric_alert", category: "reach", tags: ["cpa"], title: "CPA drifted above target", body: "CPA has been above $40 for 3 days." }],
    };
    const first = await niceBackendFetch(`${BASE}/findings`, { accessType: "server", method: "POST", body });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ created_count: 1, skipped_count: 0 });

    const second = await niceBackendFetch(`${BASE}/findings`, { accessType: "server", method: "POST", body });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ created_count: 0, skipped_count: 1 });
  });

  it("does not accept an arbitrary source from the body — sending one 400s as an unknown field", async ({ expect }) => {
    await createGrowthProject();
    const response = await niceBackendFetch(`${BASE}/findings`, {
      accessType: "server",
      method: "POST",
      body: {
        workflow_id: "customer-workflow-cpa-monitor",
        source: "daily-brief", // not a field this route accepts; source is always workflow_id.
        findings: [{ kind: "metric_alert", category: "reach", tags: [], title: "t", body: "b" }],
      },
    });
    expect(response.status).toBe(400);
  });
});

describe("growth-server/action-items", () => {
  it("rejects type_id: \"run_ads\" — a scheduled workflow may never author a campaign spec", async ({ expect }) => {
    await createGrowthProject();
    const response = await niceBackendFetch(`${BASE}/action-items`, {
      accessType: "server",
      method: "POST",
      body: {
        workflow_id: "customer-workflow-cpa-monitor",
        type_id: "run_ads",
        category: "reach",
        tags: [],
        title: "Raise the bid",
        description: "CPA drifted, consider raising the bid.",
        dedupe_key: "cpa-drift-2026-08-05",
      },
    });
    expect(response.status).toBe(400);
  });

  it("rejects a `workflow` field — an automation may never author another automation, unreviewed", async ({ expect }) => {
    await createGrowthProject();
    const response = await niceBackendFetch(`${BASE}/action-items`, {
      accessType: "server",
      method: "POST",
      body: {
        workflow_id: "customer-workflow-cpa-monitor",
        type_id: "custom",
        category: "reach",
        tags: [],
        title: "Raise the bid",
        description: "CPA drifted, consider raising the bid.",
        dedupe_key: "cpa-drift-2026-08-05",
        workflow: { workflow_id: "sneaky-auto-bid", source: "on_event() {}", explanation: "x", rollback_note: "y" },
      },
    });
    expect(response.status).toBe(400);
  });

  it("requires dedupe_key", async ({ expect }) => {
    await createGrowthProject();
    const response = await niceBackendFetch(`${BASE}/action-items`, {
      accessType: "server",
      method: "POST",
      body: {
        workflow_id: "customer-workflow-cpa-monitor",
        type_id: "custom",
        category: "reach",
        tags: [],
        title: "Raise the bid",
        description: "CPA drifted, consider raising the bid.",
      },
    });
    expect(response.status).toBe(400);
  });

  it("no-ops on a repeated dedupe_key instead of filing a new item every run", async ({ expect }) => {
    await createGrowthProject();
    const body = {
      workflow_id: "customer-workflow-cpa-monitor",
      type_id: "custom",
      category: "reach",
      tags: ["cpa"],
      title: "Raise the bid",
      description: "CPA drifted, consider raising the bid.",
      dedupe_key: "cpa-drift-2026-08-05",
    };
    const first = await niceBackendFetch(`${BASE}/action-items`, { accessType: "server", method: "POST", body });
    expect(first.status).toBe(200);
    const firstBody = first.body as { action_item_id: string, deduped: boolean };
    expect(firstBody.deduped).toBe(false);

    const second = await niceBackendFetch(`${BASE}/action-items`, { accessType: "server", method: "POST", body });
    expect(second.status).toBe(200);
    const secondBody = second.body as { action_item_id: string, deduped: boolean };
    expect(secondBody.deduped).toBe(true);
    expect(secondBody.action_item_id).toBe(firstBody.action_item_id);

    // A different dedupe_key for the same workflow is a genuinely different event, not a duplicate.
    const third = await niceBackendFetch(`${BASE}/action-items`, {
      accessType: "server", method: "POST", body: { ...body, dedupe_key: "cpa-drift-2026-08-06" },
    });
    expect(third.status).toBe(200);
    const thirdBody = third.body as { action_item_id: string, deduped: boolean };
    expect(thirdBody.deduped).toBe(false);
    expect(thirdBody.action_item_id).not.toBe(firstBody.action_item_id);
  });

  it("rejects unauthenticated and client-key callers", async ({ expect }) => {
    await createGrowthProject();
    for (const accessType of [null, "client"] as const) {
      const response = await niceBackendFetch(`${BASE}/action-items`, {
        accessType,
        method: "POST",
        body: { workflow_id: "w", type_id: "custom", category: "reach", tags: [], title: "t", description: "d", dedupe_key: "k" },
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
  });
});
