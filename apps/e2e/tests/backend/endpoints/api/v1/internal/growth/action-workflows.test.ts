import { describe, type ExpectStatic } from "vitest";
import { it } from "../../../../../../helpers";
import { niceBackendFetch } from "../../../../../backend-helpers";
import { createWorkflow, listRuns, pollWithTicks } from "../workflows-helpers";
import { GROWTH_AGENT_AUTH, createGrowthProject, publishGrowthReportAsStaff, requireRunId } from "./growth-helpers";

const ADMIN_BASE = "/api/latest/internal/growth";
const AGENT_BASE = "/api/latest/internal/growth-agent";
const CRON_AUTH = { "authorization": "Bearer mock_cron_secret" };

// E2E tests for agent-authored ACTION workflows: the growth agent attaches complete workflow
// source to an action item (validated via validate-workflow-source and re-validated on the report
// write), and activating the item deploys it as an ordinary customer workflow + fires its one-shot
// activation event transactionally. This file must NOT use mock-eve (its fixed port belongs to
// growth-workflows.test.ts exclusively) — action workflows never dispatch to Eve; their runs
// execute in the real workflow sandbox (freestyle mock), driven by the shared engine-tick helpers.

async function tickGrowthWatchdog(expect: ExpectStatic) {
  const response = await niceBackendFetch("/api/v1/internal/growth-watchdog-step", {
    method: "GET",
    headers: CRON_AUTH,
    query: { only_one_step: "true" },
  });
  expect(response.status).toBe(200);
}

async function setUpOnboardedProject() {
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
    throw new Error(`Growth onboarding failed with status ${onboarding.status}: ${JSON.stringify(onboarding.body)}`);
  }
  return {
    scope: { project_id: projectKeys.projectId, branch_id: "main" },
    runId: requireRunId(onboarding.body),
  };
}

/**
 * A trivial-but-real one-shot action workflow: triggers on its own activation event, runs a single
 * pure-computation step in the real sandbox, and completes. The runKey/onConflict pair follows the
 * authoring rules (re-activations can never double-run).
 */
function oneShotSource(workflowId: string, slug: string): string {
  return `import { workflow, customEvent } from "@hexclave/workflows";
export default workflow<{ title: string }>("${workflowId}", {
  on: [customEvent("growth.action.${slug}")],
  runKey: () => "activation",
  onConflict: "skip",
}, async (event, step) => {
  await step.run("measure-title", () => event.data.title.length);
});
`;
}

/** Like oneShotSource, but parks on a 1h sleep so its run deterministically never completes in-test. */
function sleepingOneShotSource(workflowId: string, slug: string): string {
  return `import { workflow, customEvent } from "@hexclave/workflows";
export default workflow("${workflowId}", {
  on: [customEvent("growth.action.${slug}")],
  runKey: () => "activation",
  onConflict: "skip",
}, async (event, step) => {
  await step.sleep("long-nap", "1h");
});
`;
}

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

type WireActionItem = {
  id: string,
  status: string,
  title: string,
  completed_at_millis: number | null,
  workflow: {
    workflow_id: string,
    source: string,
    triggers: { type: string, event_type?: string }[],
    explanation: string,
    rollback_note: string,
    status: string,
    last_run_state: string | null,
    warnings: string[],
  } | null,
};

async function listActionItems(query: Record<string, string> = {}): Promise<WireActionItem[]> {
  const response = await niceBackendFetch(`${ADMIN_BASE}/actions`, { accessType: "admin", query });
  if (response.status !== 200) throw new Error(`Listing actions failed: ${JSON.stringify(response.body)}`);
  return (response.body as { items: WireActionItem[] }).items;
}

async function findWorkflowInList(workflowId: string) {
  const response = await niceBackendFetch("/api/v1/internal/workflows", { method: "GET", accessType: "admin" });
  if (response.status !== 200) throw new Error(`Listing workflows failed: ${JSON.stringify(response.body)}`);
  return (response.body.workflows as { id: string }[]).find((workflow) => workflow.id === workflowId) ?? null;
}

describe("growth action-workflow authoring (validate-workflow-source)", () => {
  it("rejects bad ids, non-self-contained sources, id mismatches, foreign activation events, and taken ids; accepts a good source with its manifest", { timeout: 120_000 }, async ({ expect }) => {
    const projectKeys = await createGrowthProject();
    if (projectKeys === "no-project") throw new Error("createGrowthProject should have switched the context to a fresh project.");
    const scope = { project_id: projectKeys.projectId, branch_id: "main" };

    // Missing growth- prefix (cheap policy check, no compile).
    const badPrefix = await validateWorkflowSource(scope, "my-workflow", oneShotSource("my-workflow", "x"));
    expect(badPrefix).toMatchObject({ valid: false, workflow_id_available: false });
    expect(badPrefix.error).toContain('start with "growth-"');

    // Non-self-contained source (disallowed import) is rejected by the dry-compile.
    const badImport = await validateWorkflowSource(scope, "growth-action-imports", `import fs from "fs";\n${oneShotSource("growth-action-imports", "imports")}`);
    expect(badImport.valid).toBe(false);
    expect(badImport.error).toContain("self-contained");

    // The id inside workflow() must equal the attached workflow id.
    const mismatch = await validateWorkflowSource(scope, "growth-action-mismatch", oneShotSource("growth-action-other", "mismatch"));
    expect(mismatch.valid).toBe(false);
    expect(typeof mismatch.error).toBe("string");

    // A workflow may only subscribe to its OWN item's activation event.
    const foreignEvent = await validateWorkflowSource(scope, "growth-action-mine", oneShotSource("growth-action-mine", "someone-elses-slug"));
    expect(foreignEvent.valid).toBe(false);
    expect(foreignEvent.error).toContain("own item's activation");

    // Good source: valid, id available, and the manifest carries the parsed activation trigger.
    const good = await validateWorkflowSource(scope, "growth-action-good", oneShotSource("growth-action-good", "good"));
    expect(good).toMatchObject({
      valid: true,
      error: null,
      workflow_id_available: true,
      warnings: [],
      manifest: { triggers: [{ type: "event", event_type: "custom.growth.action.good" }] },
    });

    // The warnings scan surfaces external domains referenced by the source (best-effort, non-blocking).
    const withDomain = await validateWorkflowSource(scope, "growth-action-domained", oneShotSource("growth-action-domained", "domained") + "// docs: https://example.com/analysis topic\n");
    expect(withDomain.valid).toBe(true);
    expect(withDomain.warnings).toEqual(["Source references external domain: example.com"]);

    // Taken id: deploy a workflow under the id first (as the customer could), then validate.
    await createWorkflow(expect, "growth-action-taken", oneShotSource("growth-action-taken", "taken"));
    const taken = await validateWorkflowSource(scope, "growth-action-taken", oneShotSource("growth-action-taken", "taken"));
    expect(taken).toMatchObject({ valid: false, workflow_id_available: false });
    expect(taken.error).toContain("already exists");
  });

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

describe("growth action-workflow lifecycle", () => {
  it("carries the workflow on the report wire, deploys + completes it through activation, and tears it down on dismissal/deletion", { timeout: 300_000 }, async ({ expect }) => {
    const { scope, runId } = await setUpOnboardedProject();

    const loopWorkflowId = "growth-action-e2e-loop";
    const dismissWorkflowId = "growth-action-e2e-dismiss";
    const deleteWorkflowId = "growth-action-e2e-delete";
    const report = await niceBackendFetch(`${AGENT_BASE}/report`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: {
        ...scope,
        run_id: runId,
        title: "Growth analysis for Plannery",
        summary: "Automations to try.",
        content_md: "# Report",
        action_items: [
          {
            type_id: "custom",
            category: "product",
            tags: ["automation"],
            title: "Tag new signups",
            description: "One-shot data pass.",
            workflow: {
              workflow_id: loopWorkflowId,
              source: oneShotSource(loopWorkflowId, "e2e-loop"),
              explanation: "Runs one pure computation when activated.",
              rollback_note: "Nothing to roll back; the workflow only reads data.",
            },
          },
          {
            type_id: "custom",
            category: "retention",
            tags: ["automation"],
            title: "Weekly cleanup",
            description: "Will be dismissed while active.",
            workflow: {
              workflow_id: dismissWorkflowId,
              // Sleeping variant on purpose: if this run could complete, a concurrently-running
              // watchdog sweep (e.g. the dev cron runner) could flip the item to completed in the
              // window between our activate and dismiss calls, turning the dismiss into a 400.
              source: sleepingOneShotSource(dismissWorkflowId, "e2e-dismiss"),
              explanation: "Dismissal fixture.",
              rollback_note: "Dismiss the action to remove the automation.",
            },
          },
          {
            type_id: "custom",
            category: "product",
            tags: ["automation"],
            title: "Long-running automation",
            description: "The customer will delete its workflow.",
            workflow: {
              workflow_id: deleteWorkflowId,
              // Parks on a sleep so its activation run deterministically never completes in-test —
              // required below to pin that a customer-deleted workflow transitions NOTHING.
              source: sleepingOneShotSource(deleteWorkflowId, "e2e-delete"),
              explanation: "Deletion fixture.",
              rollback_note: "Delete the workflow in the workflows app.",
            },
          },
          { type_id: "custom", category: "conversion", tags: [], title: "Plain suggestion", description: "No automation attached." },
        ],
      },
    });
    expect(report.status).toBe(200);
    // Released to the customer, the way staff would: the report wire and the action routes below are
    // all withheld until then. Publishing this report rather than seeding another keeps it "latest".
    await publishGrowthReportAsStaff(scope.project_id, (report.body as { report_id: string }).report_id);
    const actionItemIds = (report.body as { action_item_ids: string[] }).action_item_ids;
    expect(actionItemIds).toHaveLength(4);
    const [loopItemId, dismissItemId, deleteItemId, plainItemId] = actionItemIds;

    // The admin report wire carries the full workflow object for workflow-bearing items (and
    // explicit null for plain ones). Nothing is deployed yet.
    const latestReport = await niceBackendFetch(`${ADMIN_BASE}/reports/latest`, { accessType: "admin" });
    expect(latestReport.status).toBe(200);
    const reportItems = (latestReport.body as { action_items: WireActionItem[] }).action_items;
    const loopItemOnReport = reportItems.find((item) => item.id === loopItemId);
    expect(loopItemOnReport?.workflow).toMatchObject({
      workflow_id: loopWorkflowId,
      source: oneShotSource(loopWorkflowId, "e2e-loop"),
      triggers: [{ type: "event", event_type: "custom.growth.action.e2e-loop" }],
      explanation: "Runs one pure computation when activated.",
      rollback_note: "Nothing to roll back; the workflow only reads data.",
      status: "not_deployed",
      last_run_state: null,
      warnings: [],
    });
    expect(reportItems.find((item) => item.id === plainItemId)?.workflow).toBeNull();
    expect(await findWorkflowInList(loopWorkflowId)).toBeNull();

    // FULL LOOP: activation deploys the workflow (ack carries the id), fires the one-shot event,
    // the real sandbox executes the run to completion, and the watchdog sweep completes the item.
    const activate = await niceBackendFetch(`${ADMIN_BASE}/actions/${loopItemId}/activate`, { accessType: "admin", method: "POST" });
    expect(activate).toMatchObject({ status: 200, body: { status: "active", workflow_id: loopWorkflowId } });
    expect(await findWorkflowInList(loopWorkflowId)).toMatchObject({ id: loopWorkflowId });

    const completedRun = await pollWithTicks(expect, async () => {
      const { runs } = await listRuns(loopWorkflowId);
      return runs.find((run) => run.run_key === "activation" && run.state === "completed") ?? null;
    }, { timeoutMs: 180_000 });
    expect(completedRun).toMatchObject({ trigger_type: "custom.growth.action.e2e-loop" });

    // The wire now derives "deployed" with the completed run state...
    const activeItems = await listActionItems({ status: "active" });
    expect(activeItems.find((item) => item.id === loopItemId)?.workflow).toMatchObject({
      workflow_id: loopWorkflowId,
      status: "deployed",
      last_run_state: "completed",
    });

    // ...and one watchdog sweep flips the one-shot item to completed.
    await tickGrowthWatchdog(expect);
    const completedItems = await listActionItems({ status: "completed" });
    const completedItem = completedItems.find((item) => item.id === loopItemId);
    expect(completedItem).toMatchObject({ id: loopItemId, status: "completed" });
    expect(typeof completedItem?.completed_at_millis).toBe("number");

    // DISMISS-ACTIVE deletes the deployed workflow.
    const activateDismiss = await niceBackendFetch(`${ADMIN_BASE}/actions/${dismissItemId}/activate`, { accessType: "admin", method: "POST" });
    expect(activateDismiss).toMatchObject({ status: 200, body: { status: "active", workflow_id: dismissWorkflowId } });
    expect(await findWorkflowInList(dismissWorkflowId)).toMatchObject({ id: dismissWorkflowId });
    const dismiss = await niceBackendFetch(`${ADMIN_BASE}/actions/${dismissItemId}/dismiss`, { accessType: "admin", method: "POST" });
    expect(dismiss).toMatchObject({ status: 200, body: { status: "dismissed" } });
    expect(await findWorkflowInList(dismissWorkflowId)).toBeNull();

    // CUSTOMER DELETION: deleting the workflow in the workflows app derives the "deleted" wire
    // status but deliberately transitions nothing (no auto-complete, no auto-dismiss)...
    const activateDelete = await niceBackendFetch(`${ADMIN_BASE}/actions/${deleteItemId}/activate`, { accessType: "admin", method: "POST" });
    expect(activateDelete).toMatchObject({ status: 200, body: { status: "active", workflow_id: deleteWorkflowId } });
    const customerDelete = await niceBackendFetch(`/api/v1/internal/workflows/${deleteWorkflowId}`, { method: "DELETE", accessType: "admin" });
    expect(customerDelete.status).toBe(200);
    const itemsAfterDelete = await listActionItems({ status: "active" });
    expect(itemsAfterDelete.find((item) => item.id === deleteItemId)).toMatchObject({
      status: "active",
      workflow: { workflow_id: deleteWorkflowId, status: "deleted", last_run_state: null },
    });
    await tickGrowthWatchdog(expect);
    expect((await listActionItems({ status: "active" })).some((item) => item.id === deleteItemId)).toBe(true);

    // ...and dismissing the item still works (the tear-down tolerates the already-gone workflow).
    const dismissDeleted = await niceBackendFetch(`${ADMIN_BASE}/actions/${deleteItemId}/dismiss`, { accessType: "admin", method: "POST" });
    expect(dismissDeleted).toMatchObject({ status: 200, body: { status: "dismissed" } });
  });

  it("rejects activation with a friendly 400 when the workflow id was taken by another workflow", { timeout: 180_000 }, async ({ expect }) => {
    const { scope, runId } = await setUpOnboardedProject();
    const collidingWorkflowId = "growth-action-e2e-collide";

    // Propose first (the id is free at authoring time, so the report write passes validation)...
    const report = await niceBackendFetch(`${AGENT_BASE}/report`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: {
        ...scope,
        run_id: runId,
        summary: "s",
        content_md: "c",
        action_items: [{
          type_id: "custom",
          category: "product",
          tags: ["automation"],
          title: "Colliding automation",
          description: "d",
          workflow: {
            workflow_id: collidingWorkflowId,
            source: oneShotSource(collidingWorkflowId, "e2e-collide"),
            explanation: "e",
            rollback_note: "r",
          },
        }],
      },
    });
    expect(report.status).toBe(200);
    await publishGrowthReportAsStaff(scope.project_id, (report.body as { report_id: string }).report_id);
    const [itemId] = (report.body as { action_item_ids: string[] }).action_item_ids;

    // ...then the customer takes the id with a DIFFERENT source before activation. Activation must
    // fail with actionable copy instead of silently overwriting the customer's workflow.
    await createWorkflow(expect, collidingWorkflowId, `import { workflow } from "@hexclave/workflows";
export default workflow("${collidingWorkflowId}", { on: ["user.created"] }, async () => {});
`);
    const activate = await niceBackendFetch(`${ADMIN_BASE}/actions/${itemId}/activate`, { accessType: "admin", method: "POST" });
    expect(activate.status).toBe(400);
    expect(JSON.stringify(activate.body)).toContain("already taken");

    // The item stays proposed and the customer's workflow is untouched.
    const items = await listActionItems({ status: "proposed" });
    expect(items.some((item) => item.id === itemId)).toBe(true);
    expect(await findWorkflowInList(collidingWorkflowId)).toMatchObject({ id: collidingWorkflowId });
  });
});
