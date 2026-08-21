import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { niceBackendFetch } from "../../../../../backend-helpers";
import { GROWTH_AGENT_AUTH, createGrowthProject, requireRunId } from "./growth-helpers";

const ADMIN_BASE = "/api/latest/internal/growth";
const SERVER_BASE = "/api/v1/internal/growth-server";
const CRON_AUTH = { "authorization": "Bearer mock_cron_secret" };

// Growth fixtures seed sandbox-backed workflows during onboarding and can land around 60s under
// full-suite load, so default-timeout tests need 90s of headroom.

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
  return { projectId: projectKeys.projectId, branchId: "main", runId: requireRunId(onboarding.body) };
}

// The growth-server bridge routes authenticate as ordinary server auth (workflow run tokens ARE
// plain server credentials), so their negatives are e2e-testable without any workflow running.
// Forged-run-id 404s on the analysis verbs live in growth-workflows.test.ts; this covers the
// remaining request-validation and gating negatives.
describe("growth-server bridge negatives", { timeout: 90_000 }, () => {
  it("rejects client access, growth-disabled projects, and invalid rollup dates", async ({ expect }) => {
    const { runId } = await setUpOnboardedProject();

    // Client credentials are never enough for the bridge.
    const clientTick = await niceBackendFetch(`${SERVER_BASE}/analysis/tick`, {
      method: "POST",
      accessType: "client",
      body: { run_id: runId },
    });
    expect(clientTick.status).toBe(401);

    // The rollup only accepts fully-elapsed recent UTC days: today, ancient history, and
    // calendar-invalid dates are all clean 400s.
    const today = new Date().toISOString().slice(0, 10);
    for (const date of [today, "2000-01-01", "2026-02-30"]) {
      const rollup = await niceBackendFetch(`${SERVER_BASE}/daily/rollup`, {
        method: "POST",
        accessType: "server",
        body: { date },
      });
      expect(rollup.status).toBe(400);
    }

    // Unknown brief ids are uniform 404s on every brief verb.
    const forgedBriefId = "00000000-0000-4000-8000-000000000000";
    for (const path of ["daily/dispatch-brief", "daily/skip-brief", "daily/wire-deliveries"]) {
      const response = await niceBackendFetch(`${SERVER_BASE}/${path}`, {
        method: "POST",
        accessType: "server",
        body: { brief_id: forgedBriefId },
      });
      expect(response.status).toBe(404);
    }
  });
});
