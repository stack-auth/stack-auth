import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Project, backendContext, niceBackendFetch } from "../../../../backend-helpers";

const EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN = "emailable-not-deliverable.example.com";

function expectValidRiskScores(expect: typeof import("vitest").expect, scores: { bot: number, free_trial_abuse: number }) {
  expect(scores.bot).toBeGreaterThanOrEqual(0);
  expect(scores.bot).toBeLessThanOrEqual(100);
  expect(scores.free_trial_abuse).toBeGreaterThanOrEqual(0);
  expect(scores.free_trial_abuse).toBeLessThanOrEqual(100);
  expect(Number.isInteger(scores.bot)).toBe(true);
  expect(Number.isInteger(scores.free_trial_abuse)).toBe(true);
}

describe("with admin access", () => {
  it("uses default action when no rules match", async ({ expect }) => {
    await Project.createAndSwitch({ config: {} });
    backendContext.set({ ipData: undefined });
    const response = await niceBackendFetch("/api/v1/internal/sign-up-rules-test", {
      method: "POST",
      accessType: "admin",
      body: {
        email: "user@example.com",
        auth_method: "password",
        oauth_provider: null,
        country_code: null,
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
    backendContext.set({ ipData: undefined });
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
        country_code: null,
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

  it("evaluates risk score conditions from admin overrides", async ({ expect }) => {
    await Project.createAndSwitch();
    backendContext.set({ ipData: undefined });
    await Project.updateConfig({
      "auth.signUpRules.block-high-bot-score": {
        enabled: true,
        displayName: "Block high bot score",
        priority: 1,
        condition: "riskScores.bot >= 50",
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
        email: "user@example.com",
        auth_method: "password",
        oauth_provider: null,
        country_code: null,
        risk_scores: {
          bot: 100,
          free_trial_abuse: 100,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      context: {
        risk_scores: {
          bot: 100,
          free_trial_abuse: 100,
        },
      },
      outcome: {
        should_allow: false,
        decision: "reject",
        decision_rule_id: "block-high-bot-score",
      },
    });
  });

  it("returns derived risk_scores when no override is provided", async ({ expect }) => {
    await Project.createAndSwitch();
    backendContext.set({ ipData: undefined });
    await Project.updateConfig({
      "auth.signUpRules.block-high-bot-score": {
        enabled: true,
        displayName: "Block high bot score",
        priority: 1,
        condition: "riskScores.bot >= 1",
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
        email: `user@${EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN}`,
        auth_method: "password",
        oauth_provider: null,
        country_code: null,
      },
    });

    expect(response.status).toBe(200);
    expectValidRiskScores(expect, response.body.context.risk_scores);
    expect(response.body.outcome).toMatchObject({
      should_allow: response.body.context.risk_scores.bot >= 1 ? false : true,
      decision: response.body.context.risk_scores.bot >= 1 ? "reject" : "default-allow",
    });
  });

  it("uses derived risk_scores for turnstile input unless risk_scores are overridden", async ({ expect }) => {
    await Project.createAndSwitch();
    backendContext.set({ ipData: undefined });
    await Project.updateConfig({
      "auth.signUpRules.block-high-bot-score": {
        enabled: true,
        displayName: "Block high bot score",
        priority: 1,
        condition: "riskScores.bot >= 1",
        action: {
          type: "reject",
          message: "High bot risk",
        },
      },
      "auth.signUpRulesDefaultAction": "allow",
    });

    const derivedResponse = await niceBackendFetch("/api/v1/internal/sign-up-rules-test", {
      method: "POST",
      accessType: "admin",
      body: {
        email: "user@example.com",
        auth_method: "password",
        oauth_provider: null,
        country_code: null,
        turnstile_result: "invalid",
      },
    });

    expect(derivedResponse.status).toBe(200);
    expect(derivedResponse.body.context.turnstile_result).toBe("invalid");
    expectValidRiskScores(expect, derivedResponse.body.context.risk_scores);

    const overriddenResponse = await niceBackendFetch("/api/v1/internal/sign-up-rules-test", {
      method: "POST",
      accessType: "admin",
      body: {
        email: "user@example.com",
        auth_method: "password",
        oauth_provider: null,
        country_code: null,
        turnstile_result: "invalid",
        risk_scores: {
          bot: 10,
          free_trial_abuse: 10,
        },
      },
    });

    expect(overriddenResponse.status).toBe(200);
    expect(overriddenResponse.body).toMatchObject({
      context: {
        turnstile_result: "invalid",
        risk_scores: {
          bot: 10,
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

  it("evaluates country code conditions from admin overrides", async ({ expect }) => {
    await Project.createAndSwitch();
    backendContext.set({
      ipData: {
        ipAddress: "127.0.0.1",
        country: "DE",
        city: "New York",
        region: "NY",
        latitude: 40.7128,
        longitude: -74.006,
        tzIdentifier: "America/New_York",
      },
    });
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
        auth_method: "password",
        oauth_provider: null,
        country_code: "us",
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
    backendContext.set({
      ipData: {
        ipAddress: "127.0.0.1",
        country: "CA",
        city: "Toronto",
        region: "ON",
        latitude: 43.6532,
        longitude: -79.3832,
        tzIdentifier: "America/Toronto",
      },
    });
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
        auth_method: "password",
        oauth_provider: null,
        country_code: null,
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
