import { describe, expect, test } from "vitest";
import { growthRequestHeaders, mapGrowthReport, parseGrowthAdsBody, reportSchema } from "./growth-api";

// Regression coverage for a bug that silently broke every bodyless growth mutation — retry, skip,
// retake, activate, dismiss, mark-brief-read. Declaring `content-type: application/json` with no
// body made the backend reject the request with a 400 BODY_PARSING_ERROR, which the SDK then failed
// to construct an error from (its BodyParsingError reads `json.details.message`, and the backend's
// error body has no `details`), so every one of those buttons died with an unactionable
// "TypeError: Cannot read properties of undefined (reading 'message')".
describe("growthRequestHeaders", () => {
  test("omits content-type when there is no body, so empty POSTs are not parsed as JSON", () => {
    expect(growthRequestHeaders({ method: "POST" })).toMatchInlineSnapshot(`{}`);
    expect(growthRequestHeaders({})).toMatchInlineSnapshot(`{}`);
  });

  test("declares JSON content-type whenever a body is present", () => {
    expect(growthRequestHeaders({ method: "POST", body: JSON.stringify({ trigger: "manual" }) })).toMatchInlineSnapshot(`
      {
        "content-type": "application/json",
      }
    `);
    // An empty-string body is still a body, and still needs the header to parse as JSON.
    expect(growthRequestHeaders({ method: "POST", body: "" })).toMatchInlineSnapshot(`
      {
        "content-type": "application/json",
      }
    `);
  });

  test("lets an explicit caller header win over the default", () => {
    expect(growthRequestHeaders({ method: "POST", body: "x", headers: { "content-type": "text/plain" } })).toMatchInlineSnapshot(`
      {
        "content-type": "text/plain",
      }
    `);
    expect(growthRequestHeaders({ method: "POST", headers: { "x-trace": "abc" } })).toMatchInlineSnapshot(`
      {
        "x-trace": "abc",
      }
    `);
  });
});

// ---------------------------------------------------------------------------------------------
// parseGrowthAdsBody
// ---------------------------------------------------------------------------------------------

/**
 * The ads body is the wire shape a human reads before deciding whether an AI-built campaign is safe
 * to publish, so its parsing has two jobs beyond shape-checking: keep the agent's claims separate
 * from what we verified, and stay readable when the backend grows a value this dashboard predates.
 */
function adsWire(overrides: Record<string, unknown> = {}) {
  return {
    status: "creating",
    creation_step: "dispatched",
    attempt: 1,
    platform: "meta",
    account_id: "act_1",
    campaign: null,
    ad_set: null,
    creative: null,
    ad: null,
    currency: "USD",
    daily_budget_minor: 2000,
    lifetime_budget_minor: null,
    orphaned_external_ids: [],
    last_error: { stage: null, code: null, subcode: null },
    published_at_millis: null,
    published_by_user_id: null,
    paused_at_millis: null,
    created_at_millis: 1_700_000_000_000,
    reconciled_at_millis: null,
    may_be_live_unconfirmed: false,
    verification: { outcome: null, verified_at_millis: null, findings: [] },
    execution: { mode: null, attempt: null, status: null, dispatched_at_millis: null, lease_expires_at_millis: null, agent_reported_ids: {} },
    publish_in_progress: false,
    ...overrides,
  };
}

describe("parseGrowthAdsBody", () => {
  test("returns a mapped body rather than recursing — a self-call here would blow the stack", () => {
    // Not a hypothetical: an earlier refactor rewrote this function's own body into a call to itself.
    // It typechecked cleanly, because the signature matched perfectly.
    const body = parseGrowthAdsBody(adsWire());
    expect(body.status).toBe("creating");
    expect(body.accountId).toBe("act_1");
  });

  test("collapses an unrecognized verification outcome to null instead of throwing", () => {
    // A backend that grows a sixth verdict must not make every campaign unparseable here. null routes
    // into the panel's "not verified" branch, which refuses to present the campaign as confirmed —
    // the safe reading rather than an optimistic guess.
    expect(parseGrowthAdsBody(adsWire({
      verification: { outcome: "some_future_verdict", verified_at_millis: 1, findings: [] },
    })).verification.outcome).toBeNull();
  });

  test("preserves the known outcomes exactly", () => {
    for (const outcome of ["verified", "verified_with_notes", "quarantine", "incomplete", "unreadable"]) {
      expect(parseGrowthAdsBody(adsWire({
        verification: { outcome, verified_at_millis: null, findings: [] },
      })).verification.outcome).toBe(outcome);
    }
  });

  test("treats any severity that is not exactly 'blocking' as a note", () => {
    const body = parseGrowthAdsBody(adsWire({
      verification: {
        outcome: "quarantine",
        verified_at_millis: null,
        findings: [
          { code: "a", severity: "blocking", level: "adset", external_id: null, expected: null, actual: null, message: "m" },
          { code: "b", severity: "catastrophic", level: "adset", external_id: null, expected: null, actual: null, message: "m" },
        ],
      },
    }));
    expect(body.verification.findings.map((f) => f.severity)).toEqual(["blocking", "note"]);
  });

  test("keeps agent-reported ids out of the verified entity fields", () => {
    const body = parseGrowthAdsBody(adsWire({
      execution: { mode: "agent", attempt: 2, status: "reported", dispatched_at_millis: 5, lease_expires_at_millis: 9, agent_reported_ids: { adSetId: "claimed" } },
    }));
    expect(body.execution.agentReportedIds).toEqual({ adSetId: "claimed" });
    expect(body.adSet).toBeNull();
    expect(body.execution.mode).toBe("agent");
  });

  test("nulls an unrecognized execution mode rather than surfacing it as a label", () => {
    expect(parseGrowthAdsBody(adsWire({
      execution: { mode: "sideways", attempt: null, status: null, dispatched_at_millis: null, lease_expires_at_millis: null, agent_reported_ids: {} },
    })).execution.mode).toBeNull();
  });
});

describe("GrowthReport wire mapping", () => {
  const base = {
    id: "report-1",
    run_id: "run-1",
    title: "Growth report",
    summary: "Summary",
    created_at_millis: 1_700_000_000_000,
    action_items: [],
  };

  test("maps a presentation-backed report without exposing legacy analysis fields", () => {
    const report = mapGrowthReport(reportSchema.parse({
      ...base,
      action_items: [{
        id: "action-1",
        type_id: "custom",
        title: "Review activation",
        description: "Review activation flow",
        status: "proposed",
        has_workflow: true,
        created_at_millis: 1_700_000_000_000,
        activated_at_millis: null,
        completed_at_millis: null,
      }],
      presentation: {
        format: "sandboxed-tsx-v1",
        version: 3,
        tsx_source: "const Dashboard = () => <div />;",
      },
    }));
    expect(report.content).toEqual({
      type: "presentation",
      format: "sandboxed-tsx-v1",
      version: 3,
      tsxSource: "const Dashboard = () => <div />;",
    });
    expect(report.content.type).toBe("presentation");
    expect(report.actionItems).toEqual([{
      id: "action-1",
      typeId: "custom",
      title: "Review activation",
      description: "Review activation flow",
      status: "proposed",
      hasWorkflow: true,
      createdAtMillis: 1_700_000_000_000,
      activatedAtMillis: null,
      completedAtMillis: null,
    }]);
  });

  test("maps a grandfathered legacy report's document content", () => {
    const report = mapGrowthReport(reportSchema.parse({
      ...base,
      content_md: "# Analysis",
      document: null,
      sections: [{ id: "section-1", kind: "insight", title: "Insight", body_markdown: "Body" }],
    }));
    expect(report.content).toEqual({
      type: "legacy",
      contentMd: "# Analysis",
      document: null,
      sections: [{ id: "section-1", kind: "insight", title: "Insight", bodyMd: "Body" }],
    });
    expect(report.content.type).toBe("legacy");
  });
});
