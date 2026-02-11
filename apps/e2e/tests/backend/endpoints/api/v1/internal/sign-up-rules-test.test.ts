import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../backend-helpers";

describe("with admin access", () => {
  it("uses default action when no rules match", async ({ expect }) => {
    await Project.createAndSwitch({ config: {} });
    const response = await niceBackendFetch("/api/v1/internal/sign-up-rules-test", {
      method: "POST",
      accessType: "admin",
      body: {
        email: "user@example.com",
        auth_method: "password",
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      evaluations: [],
      outcome: {
        should_allow: true,
        decision: "default-allow",
        decision_rule_id: null,
        restricted_because_of_rule_id: null,
      },
    });
  });

  it("returns a decision rule when an allow/reject rule matches", async ({ expect }) => {
    await Project.createAndSwitch();
    await Project.updateConfig({
      "auth.signUpRules.log-first": {
        enabled: true,
        displayName: "Log first",
        priority: 2,
        condition: 'emailDomain == "example.com"',
        action: {
          type: "log",
        },
      },
      "auth.signUpRules.block-oauth": {
        enabled: true,
        displayName: "Block OAuth",
        priority: 1,
        condition: 'authMethod == "oauth"',
        action: {
          type: "reject",
          message: "OAuth blocked",
        },
      },
      "auth.signUpRulesDefaultAction": "allow",
    });

    const response = await niceBackendFetch("/api/v1/internal/sign-up-rules-test", {
      method: "POST",
      accessType: "admin",
      body: {
        email: "test@example.com",
        auth_method: "oauth",
        oauth_provider: "google",
      },
    });

    expect(response.status).toBe(200);
    expect(response.body?.outcome).toMatchObject({
      should_allow: false,
      decision: "reject",
      decision_rule_id: "block-oauth",
      restricted_because_of_rule_id: null,
    });
    expect(response.body?.evaluations.map((evaluation: { rule_id: string }) => evaluation.rule_id)).toEqual([
      "log-first",
      "block-oauth",
    ]);
    expect(response.body?.evaluations[0]).toMatchObject({
      status: "matched",
      action: { type: "log" },
    });
    expect(response.body?.evaluations[1]).toMatchObject({
      status: "matched",
      action: { type: "reject" },
    });
  });
});
