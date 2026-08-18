import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { niceBackendFetch } from "../../../../../backend-helpers";
import { GROWTH_AGENT_AUTH, createGrowthProject } from "./growth-helpers";

const AGENT_BASE = "/api/latest/internal/growth-agent";

async function validateWorkflowSource(scope: { project_id: string, branch_id: string }, workflowId: string, source: string) {
  const response = await niceBackendFetch(`${AGENT_BASE}/validate-workflow-source`, {
    method: "POST",
    headers: GROWTH_AGENT_AUTH,
    body: { ...scope, workflow_id: workflowId, source },
  });
  if (response.status !== 200) {
    throw new Error(`validate-workflow-source failed with status ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response.body as { valid: boolean, error: string | null, manifest: { triggers: unknown[] } | null, workflow_id_available: boolean | null, warnings: string[] };
}

describe("growth action-workflow authoring (validate-workflow-source)", () => {
  it("rate-limits validation calls per project with a structured (non-HTTP-error) response", { timeout: 120_000 }, async ({ expect }) => {
    // Fresh project: the in-memory sliding window starts empty. Consume the full budget with cheap
    // invalid-id calls (the rate limit is consumed before any compile work, so these never touch
    // the sandbox).
    const projectKeys = await createGrowthProject();
    if (projectKeys === "no-project") throw new Error("createGrowthProject should have switched the context to a fresh project.");
    const scope = { project_id: projectKeys.projectId, branch_id: "main" };
    for (let i = 0; i < 20; i++) {
      const consumed = await validateWorkflowSource(scope, "not-growth-prefixed", "irrelevant");
      expect(consumed.valid).toBe(false);
    }
    const limited = await niceBackendFetch(`${AGENT_BASE}/validate-workflow-source`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, workflow_id: "not-growth-prefixed", source: "irrelevant" },
    });
    expect(limited).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "error": "Rate limit exceeded: at most 20 workflow validations per minute per project. Wait a moment and retry.",
          "manifest": null,
          "valid": false,
          "warnings": [],
          "workflow_id_available": null,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});
