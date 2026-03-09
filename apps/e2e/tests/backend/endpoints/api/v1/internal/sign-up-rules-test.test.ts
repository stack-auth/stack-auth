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
        country_code: null,
        auth_method: "password",
        oauth_provider: null,
        risk_scores: {
          bot: 0,
          free_trial_abuse: 0,
        },
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
        country_code: null,
        auth_method: "oauth",
        oauth_provider: "google",
        risk_scores: {
          bot: 0,
          free_trial_abuse: 0,
        },
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

  it("evaluates risk score conditions", async ({ expect }) => {
    await Project.createAndSwitch();
    await Project.updateConfig({
      "auth.signUpRules.block-high-bot-score": {
        enabled: true,
        displayName: "Block high bot score",
        priority: 1,
        condition: "riskScores.bot >= 80",
        action: {
          type: "reject",
          message: "High bot risk",
        },
      },
      "auth.signUpRulesDefaultAction": "allow",
    });

    const response = await niceBackendFetch("/api/v1/internal/sign-up-rules-test", {
      method: "POST",
      accessType: "admin",
      body: {
        email: "risk@example.com",
        country_code: null,
        auth_method: "password",
        oauth_provider: null,
        risk_scores: {
          bot: 90,
          free_trial_abuse: 10,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      context: {
        risk_scores: {
          bot: 90,
          free_trial_abuse: 10,
        },
      },
      outcome: {
        should_allow: false,
        decision: "reject",
        decision_rule_id: "block-high-bot-score",
      },
    });
  });

  it("evaluates country code conditions and normalizes country input", async ({ expect }) => {
    await Project.createAndSwitch();
    await Project.updateConfig({
      "auth.signUpRules.block-us": {
        enabled: true,
        displayName: "Block US signups",
        priority: 1,
        condition: 'countryCode == "US"',
        action: {
          type: "reject",
          message: "US blocked",
        },
      },
      "auth.signUpRulesDefaultAction": "allow",
    });

    const response = await niceBackendFetch("/api/v1/internal/sign-up-rules-test", {
      method: "POST",
      accessType: "admin",
      body: {
        email: "country@example.com",
        country_code: "us",
        auth_method: "password",
        oauth_provider: null,
        risk_scores: {
          bot: 0,
          free_trial_abuse: 0,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      context: {
        country_code: "US",
      },
      outcome: {
        should_allow: false,
        decision: "reject",
        decision_rule_id: "block-us",
      },
    });
  });

  it("evaluates country code in_list conditions", async ({ expect }) => {
    await Project.createAndSwitch();
    await Project.updateConfig({
      "auth.signUpRules.allow-na": {
        enabled: true,
        displayName: "Allow North America",
        priority: 1,
        condition: 'countryCode in ["US", "CA"]',
        action: {
          type: "allow",
        },
      },
      "auth.signUpRulesDefaultAction": "reject",
    });

    const response = await niceBackendFetch("/api/v1/internal/sign-up-rules-test", {
      method: "POST",
      accessType: "admin",
      body: {
        email: "country@example.com",
        country_code: "ca",
        auth_method: "password",
        oauth_provider: null,
        risk_scores: {
          bot: 0,
          free_trial_abuse: 0,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      context: {
        country_code: "CA",
      },
      outcome: {
        should_allow: true,
        decision: "allow",
        decision_rule_id: "allow-na",
      },
    });
  });
});
