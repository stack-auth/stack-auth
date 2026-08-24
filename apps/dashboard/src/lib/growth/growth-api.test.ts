import { describe, expect, test } from "vitest";
import { growthAdminActionRequestBody, growthRequestHeaders, parseGrowthAdminCategoryPagesBody, parseGrowthAdsBody } from "./growth-api";
import { readGrowthErrorMessage } from "./growth-api-client";
import type { GrowthActionItem } from "./growth-types";

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

describe("growthAdminActionRequestBody", () => {
  const action: GrowthActionItem = {
    id: "action-1", typeId: "custom", category: "reach", tags: ["funnel"], title: "Trial-extension offer", description: "Offer stalled signups a longer trial.",
    status: "proposed", payload: null, watchedMetrics: [{ metricId: "new_signups", windowDays: 14 }], reportId: null, briefId: null, workflow: null,
    createdAtMillis: 0, activatedAtMillis: null, completedAtMillis: null,
  };

  test("omits a null payload so the field is left untouched", () => {
    const body = growthAdminActionRequestBody("project-1", action, { payload: action.payload, watchedMetrics: action.watchedMetrics, workflow: null });
    expect("payload" in body).toBe(false);
    expect(body.watched_metrics).toEqual([{ metric_id: "new_signups", window_days: 14 }]);
  });

  test("sends a payload the admin actually set", () => {
    const body = growthAdminActionRequestBody("project-1", action, { payload: { qa: 1 }, watchedMetrics: [], workflow: null });
    expect(body.payload).toEqual({ qa: 1 });
  });

  test("leaves out every functional field for an action that is no longer a proposal", () => {
    const body = growthAdminActionRequestBody("project-1", { ...action, status: "active" });
    expect(Object.keys(body).sort()).toMatchInlineSnapshot(`
      [
        "category",
        "description",
        "status",
        "tags",
        "target_project_id",
        "title",
        "type_id",
      ]
    `);
  });
});

describe("parseGrowthAdminCategoryPagesBody", () => {
  function versionWire(overrides: Record<string, unknown> = {}) {
    return {
      id: "page-1",
      version: 3,
      status: "published",
      published_at_millis: 1_700_000_000_000,
      updated_at_millis: 1_700_000_000_000,
      category: "conversion",
      source_json: { format: "growth-mdx-v1", source_mdx: "## Where signups are lost", data: [] },
      document: null,
      source_item_ids: { findings: ["f1"], actions: ["a1"] },
      stale_source_ids: ["f1"],
      actions: [],
      ...overrides,
    };
  }

  test("reads the pages out of the response envelope the route sends", () => {
    const pages = parseGrowthAdminCategoryPagesBody({
      pages: [{ category: "conversion", draft: null, published: versionWire(), archived: [] }],
    });
    expect(pages.length).toBe(1);
    expect(pages[0]?.category).toBe("conversion");
    expect(pages[0]?.published?.source?.sourceMdx).toBe("## Where signups are lost");
    expect(pages[0]?.published?.staleSourceIds).toEqual(["f1"]);
  });

  test("carries a version's referenced actions, so previewing a draft resolves its buttons", () => {
    const pages = parseGrowthAdminCategoryPagesBody({
      pages: [{
        category: "conversion",
        draft: versionWire({
          status: "draft",
          published_at_millis: null,
          actions: [{
            id: "a1",
            type_id: "custom",
            category: "conversion",
            tags: [],
            title: "Fix the checkout drop-off",
            description: "Shorten the form.",
            status: "completed",
            payload: null,
            watched_metrics: [],
            report_id: null,
            brief_id: null,
            workflow: null,
            created_at_millis: 1_700_000_000_000,
            activated_at_millis: null,
            completed_at_millis: null,
          }],
        }),
        published: null,
        archived: [],
      }],
    });
    expect(pages[0]?.draft?.actions.map((action) => action.id)).toEqual(["a1"]);
  });

  test("rejects a bare array, so a future contract change fails loudly instead of rendering an empty composer", () => {
    expect(() => parseGrowthAdminCategoryPagesBody([{ category: "conversion", draft: null, published: null, archived: [] }])).toThrow();
  });

  test("keeps a version whose stored source no longer round-trips loadable, with a null source", () => {
    const pages = parseGrowthAdminCategoryPagesBody({
      pages: [{ category: "reach", draft: versionWire({ category: "reach", status: "draft", published_at_millis: null, source_json: { format: "some-older-format" } }), published: null, archived: [] }],
    });
    expect(pages[0]?.draft?.source).toBe(null);
    expect(pages[0]?.draft?.status).toBe("draft");
  });
});

describe("readGrowthErrorMessage", () => {
  test("reads a plain-text StatusError body", () => {
    expect(readGrowthErrorMessage("This page references an action from another stage: abc", "fallback")).toBe("This page references an action from another stage: abc");
  });

  test("reads the error field of the route handler's JSON body", () => {
    expect(readGrowthErrorMessage("{\"code\":\"X\",\"error\":\"Something specific\"}", "fallback")).toBe("Something specific");
  });

  test.each([
    ["an empty body", ""],
    ["an HTML error page from a proxy", "<html><body>502 Bad Gateway</body></html>"],
    ["JSON without an error field", "{\"code\":\"X\"}"],
    ["a body too long to be a message for a human", "x".repeat(401)],
  ])("falls back for %s", (_label, body) => {
    expect(readGrowthErrorMessage(body, "fallback")).toBe("fallback");
  });
});
