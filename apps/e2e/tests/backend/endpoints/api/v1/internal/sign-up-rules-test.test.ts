import { riskScoreWeights } from "@stackframe/stack-shared/dist/utils/risk-score-weights";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Project, backendContext, niceBackendFetch } from "../../../../backend-helpers";

type ScorePair = {
  bot: number,
  free_trial_abuse: number,
};

const EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN = "emailable-not-deliverable.example.com";

function sumScores(...contributions: ScorePair[]): ScorePair {
  return {
    bot: Math.min(100, contributions.reduce((score, contribution) => score + contribution.bot, 0)),
    free_trial_abuse: Math.min(100, contributions.reduce((score, contribution) => score + contribution.free_trial_abuse, 0)),
  };
}

const derivedTurnstileRiskScore = riskScoreWeights.turnstile;
const derivedNonDeliverablePasswordRiskScore = sumScores(riskScoreWeights.emailable, riskScoreWeights.turnstile);

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
        condition: `riskScores.bot >= ${derivedNonDeliverablePasswordRiskScore.bot}`,
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

  it("derives risk score conditions from disposable-email heuristics", async ({ expect }) => {
    await Project.createAndSwitch();
    backendContext.set({ ipData: undefined });
    await Project.updateConfig({
      "auth.signUpRules.block-high-bot-score": {
        enabled: true,
        displayName: "Block high bot score",
        priority: 1,
        condition: `riskScores.bot >= ${derivedNonDeliverablePasswordRiskScore.bot}`,
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
    expect(response.body).toMatchObject({
      context: {
        risk_scores: {
          ...derivedNonDeliverablePasswordRiskScore,
        },
      },
      outcome: {
        should_allow: false,
        decision: "reject",
        decision_rule_id: "block-high-bot-score",
      },
    });
  });

  it("derives risk score conditions from Turnstile overrides unless risk_scores are overridden", async ({ expect }) => {
    await Project.createAndSwitch();
    backendContext.set({ ipData: undefined });
    await Project.updateConfig({
      "auth.signUpRules.block-high-bot-score": {
        enabled: true,
        displayName: "Block high bot score",
        priority: 1,
        condition: `riskScores.bot >= ${derivedTurnstileRiskScore.bot}`,
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
    expect(derivedResponse.body).toMatchObject({
      context: {
        turnstile_result: "invalid",
        risk_scores: {
          ...derivedTurnstileRiskScore,
        },
      },
      outcome: {
        should_allow: false,
        decision: "reject",
        decision_rule_id: "block-high-bot-score",
      },
    });

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
          bot: 0,
          free_trial_abuse: 0,
        },
      },
    });

    expect(overriddenResponse.status).toBe(200);
    expect(overriddenResponse.body).toMatchObject({
      context: {
        turnstile_result: "invalid",
        risk_scores: {
          bot: 0,
          free_trial_abuse: 0,
        },
      },
      outcome: {
        should_allow: true,
        decision: "default-allow",
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
