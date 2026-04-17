import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe } from "vitest";
import { it } from "../../../../helpers";
import { Auth, InternalApiKey, Project, backendContext, mockTurnstileTokens, niceBackendFetch } from "../../../backend-helpers";

const ZERO_RISK_SCORES = { bot: 0, free_trial_abuse: 0 } as const;
const EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN = "emailable-not-deliverable.example.com";
const hasPrivateRiskEngine = readFileSync(
  path.resolve(process.cwd(), "apps/backend/src/private/implementation.generated.ts"),
  "utf8",
).includes("../private/implementation/index");

const TRUSTED_IP_FIXTURE = {
  ipAddress: "127.0.0.50",
  country: "US",
  city: "New York",
  region: "NY",
  latitude: 40.7128,
  longitude: -74.006,
  tzIdentifier: "America/New_York",
} as const;

async function passwordSignUp(options: {
  email?: string,
  turnstileToken?: string,
  accessTokenOverride?: string,
} = {}): Promise<string> {
  const email = options.email ?? `risk-${generateSecureRandomString(8)}@example.com`;
  const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
    method: "POST",
    accessType: "client",
    ...(options.accessTokenOverride == null ? {} : {
      headers: {
        "x-stack-access-token": options.accessTokenOverride,
      },
    }),
    body: {
      email,
      password: generateSecureRandomString(),
      ...(options.turnstileToken == null ? {} : { bot_challenge_token: options.turnstileToken }),
    },
  });

  if (response.status !== 200) {
    throw new Error(`password sign-up failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return response.body.user_id;
}

async function readServerUser(userId: string) {
  const response = await niceBackendFetch(`/api/v1/users/${userId}`, {
    method: "GET",
    accessType: "server",
  });

  if (response.status !== 200) {
    throw new Error(`reading server user failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return response.body;
}

function expectValidRiskScores(expect: typeof import("vitest").expect, scores: { bot: number, free_trial_abuse: number }) {
  expect(scores.bot).toBeGreaterThanOrEqual(0);
  expect(scores.bot).toBeLessThanOrEqual(100);
  expect(scores.free_trial_abuse).toBeGreaterThanOrEqual(0);
  expect(scores.free_trial_abuse).toBeLessThanOrEqual(100);
  expect(Number.isInteger(scores.bot)).toBe(true);
  expect(Number.isInteger(scores.free_trial_abuse)).toBe(true);
}

function expectDerivedRiskScores(expect: typeof import("vitest").expect, scores: { bot: number, free_trial_abuse: number }) {
  if (hasPrivateRiskEngine) {
    expectValidRiskScores(expect, scores);
  } else {
    expect(scores).toEqual(ZERO_RISK_SCORES);
  }
}

describe("risk scores", () => {
  it("derives zero OSS risk scores for password sign-up even with risky-looking inputs", async ({ expect }) => {
    await Project.createAndSwitch({ config: { credential_enabled: true } });
    backendContext.set({ ipData: { ...TRUSTED_IP_FIXTURE, ipAddress: "127.0.0.61" } });

    const userId = await passwordSignUp({
      email: `user@${EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN}`,
      turnstileToken: mockTurnstileTokens.invalid,
    });

    const user = await readServerUser(userId);
    expectDerivedRiskScores(expect, user.risk_scores.sign_up);
  });

  it("derives zero OSS risk scores for OTP sign-up", async ({ expect }) => {
    await Project.createAndSwitch({ config: { magic_link_enabled: true } });

    await Auth.Otp.signIn();

    const response = await niceBackendFetch("/api/v1/users/me", { accessType: "server" });
    expect(response.status).toBe(200);
    expectDerivedRiskScores(expect, response.body.risk_scores.sign_up);
  });

  it("derives zero OSS risk scores for OAuth sign-up", async ({ expect }) => {
    await Project.createAndSwitch({ config: { oauth_providers: [{ id: "spotify", type: "shared" }] } });
    await InternalApiKey.createAndSetProjectKeys();

    const signInResult = await Auth.OAuth.signIn({ turnstileToken: mockTurnstileTokens.invalid });
    expect(signInResult.tokenResponse.status).toBe(200);

    const response = await niceBackendFetch("/api/v1/users/me", { accessType: "server" });
    expect(response.status).toBe(200);
    expectDerivedRiskScores(expect, response.body.risk_scores.sign_up);
  });

  it("keeps country code persistence independent from the private risk engine", async ({ expect }) => {
    await Project.createAndSwitch({ config: { credential_enabled: true } });
    backendContext.set({
      ipData: {
        ...TRUSTED_IP_FIXTURE,
        ipAddress: "127.0.0.62",
        country: "CA",
        city: "Toronto",
        region: "ON",
        latitude: 43.6532,
        longitude: -79.3832,
        tzIdentifier: "America/Toronto",
      },
    });

    const userId = await passwordSignUp();
    const user = await readServerUser(userId);

    expect(user.country_code).toBe("CA");
    expectDerivedRiskScores(expect, user.risk_scores.sign_up);
  });

  it("server responses include risk_scores while client responses omit them", async ({ expect }) => {
    await Project.createAndSwitch({ config: { credential_enabled: true } });

    const signUpResult = await Auth.Password.signUpWithEmail();

    const serverUser = await readServerUser(signUpResult.userId);
    expectDerivedRiskScores(expect, serverUser.risk_scores.sign_up);

    const clientResponse = await niceBackendFetch("/api/v1/users/me", { accessType: "client" });
    expect(clientResponse.status).toBe(200);
    expect(clientResponse.body).not.toHaveProperty("risk_scores");
  });

  it("client cannot update risk_scores", async ({ expect }) => {
    await Project.createAndSwitch({ config: { credential_enabled: true } });

    const signUpResult = await Auth.Password.signUpWithEmail();
    const beforeUpdate = (await readServerUser(signUpResult.userId)).risk_scores.sign_up;
    const updateResponse = await niceBackendFetch("/api/v1/users/me", {
      method: "PATCH",
      accessType: "client",
      body: {
        risk_scores: {
          sign_up: {
            bot: 99,
            free_trial_abuse: 99,
          },
        },
      },
    });

    expect(updateResponse.status).toBe(400);
    expect((await readServerUser(signUpResult.userId)).risk_scores.sign_up).toEqual(beforeUpdate);
  });

  it("server can update risk_scores explicitly", async ({ expect }) => {
    await Project.createAndSwitch({ config: { credential_enabled: true } });

    const userId = await passwordSignUp();
    const updateResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "PATCH",
      accessType: "server",
      body: {
        risk_scores: {
          sign_up: {
            bot: 75,
            free_trial_abuse: 30,
          },
        },
      },
    });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.risk_scores).toEqual({
      sign_up: {
        bot: 75,
        free_trial_abuse: 30,
      },
    });

    expect((await readServerUser(userId)).risk_scores.sign_up).toEqual({
      bot: 75,
      free_trial_abuse: 30,
    });
  });

  it("server-side validation still rejects invalid risk_scores payloads", async ({ expect }) => {
    await Project.createAndSwitch({ config: { credential_enabled: true } });

    const userId = await passwordSignUp();

    const tooLargeResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "PATCH",
      accessType: "server",
      body: {
        risk_scores: {
          sign_up: {
            bot: 101,
            free_trial_abuse: 0,
          },
        },
      },
    });
    expect(tooLargeResponse.status).toBe(400);

    const nonIntegerResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "PATCH",
      accessType: "server",
      body: {
        risk_scores: {
          sign_up: {
            bot: 50.5,
            free_trial_abuse: 0,
          },
        },
      },
    });
    expect(nonIntegerResponse.status).toBe(400);
  });

  it("server can create users with explicit risk_scores and country_code", async ({ expect }) => {
    await Project.createAndSwitch({ config: { credential_enabled: true } });

    const createResponse = await niceBackendFetch("/api/v1/users", {
      method: "POST",
      accessType: "server",
      body: {
        primary_email: `server-${generateSecureRandomString(8)}@example.com`,
        country_code: "FR",
        risk_scores: {
          sign_up: {
            bot: 55,
            free_trial_abuse: 42,
          },
        },
      },
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.country_code).toBe("FR");
    expect(createResponse.body.risk_scores).toEqual({
      sign_up: {
        bot: 55,
        free_trial_abuse: 42,
      },
    });
  });

  it("server-created users default to zero risk_scores without derived sign-up logic", async ({ expect }) => {
    await Project.createAndSwitch({ config: { credential_enabled: true } });

    const createResponse = await niceBackendFetch("/api/v1/users", {
      method: "POST",
      accessType: "server",
      body: {
        primary_email: `server-default-${generateSecureRandomString(8)}@example.com`,
      },
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.risk_scores.sign_up).toEqual(ZERO_RISK_SCORES);
  });

  it("anonymous users start at zero and conversion keeps risk_scores valid", async ({ expect }) => {
    await Project.createAndSwitch({ config: { credential_enabled: true } });

    const anonymousResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
      method: "POST",
      accessType: "client",
      body: {},
    });
    expect(anonymousResponse.status).toBe(200);
    expect((await readServerUser(anonymousResponse.body.user_id)).risk_scores.sign_up).toEqual(ZERO_RISK_SCORES);

    const convertedUserId = await passwordSignUp({
      email: `convert-${generateSecureRandomString(8)}@example.com`,
      accessTokenOverride: anonymousResponse.body.access_token,
    });
    expectDerivedRiskScores(expect, (await readServerUser(convertedUserId)).risk_scores.sign_up);
  });
});
