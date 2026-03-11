import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { describe } from "vitest";
import { it } from "../../../../helpers";
import { Auth, InternalApiKey, Project, backendContext, mockTurnstileTokens, niceBackendFetch } from "../../../backend-helpers";

describe("risk scores", () => {
  // ==========================================
  // PERSISTENCE ON SIGNUP
  // ==========================================

  describe("persistence on password signup", () => {
    it("should persist non-zero risk scores for disposable-email domains", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: "user@emailable-not-deliverable.example.com",
          password: generateSecureRandomString(),
        },
      });
      expect(response.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${response.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(userResponse.status).toBe(200);
      expect(userResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 100,
          free_trial_abuse: 100,
        },
      });
    });

    it("should persist zero risk scores for normal signups", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const res = await Auth.Password.signUpWithEmail({
        turnstileToken: mockTurnstileTokens.signUpOk,
      });
      expect(res.signUpResponse.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${res.userId}`, {
        method: "GET",
        accessType: "server",
      });

      expect(userResponse.status).toBe(200);
      expect(userResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 0,
          free_trial_abuse: 0,
        },
      });
    });

    it("should persist Turnstile-derived risk scores for invalid and error assessments", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const invalidResult = await Auth.Password.signUpWithEmail({
        noWaitForEmail: true,
        turnstileToken: mockTurnstileTokens.invalid,
      });
      expect(invalidResult.signUpResponse.status).toBe(200);

      const invalidUserResponse = await niceBackendFetch(`/api/v1/users/${invalidResult.userId}`, {
        method: "GET",
        accessType: "server",
      });
      expect(invalidUserResponse.status).toBe(200);
      expect(invalidUserResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 80,
          free_trial_abuse: 40,
        },
      });

      backendContext.set({ userAuth: null });
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const errorResult = await Auth.Password.signUpWithEmail({
        noWaitForEmail: true,
        turnstileToken: mockTurnstileTokens.error,
      });
      expect(errorResult.signUpResponse.status).toBe(200);

      const errorUserResponse = await niceBackendFetch(`/api/v1/users/${errorResult.userId}`, {
        method: "GET",
        accessType: "server",
      });
      expect(errorUserResponse.status).toBe(200);
      expect(errorUserResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 0,
          free_trial_abuse: 0,
        },
      });
    });

    it("should treat omitted Turnstile fields as invalid for backward compatibility", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const email = `turnstile-legacy-${generateSecureRandomString(8)}@example.com`;
      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email,
          password: generateSecureRandomString(),
        },
      });
      expect(response.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${response.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(userResponse.status).toBe(200);
      expect(userResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 80,
          free_trial_abuse: 40,
        },
      });
    });

    it("should require a visible challenge after an invisible failure and persist the reduced recovered score", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const email = `turnstile-recovered-${generateSecureRandomString(8)}@example.com`;
      const password = generateSecureRandomString();
      const firstResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email,
          password,
          turnstile_token: mockTurnstileTokens.invalid,
          turnstile_phase: "invisible",
        },
      });

      expect(firstResponse.status).toBe(409);
      expect(firstResponse.body).toMatchObject({
        code: "TURNSTILE_CHALLENGE_REQUIRED",
        details: {
          invisible_result: "invalid",
        },
      });

      const secondResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email,
          password,
          turnstile_token: mockTurnstileTokens.visibleSignUpOk,
          turnstile_phase: "visible",
          turnstile_previous_result: "invalid",
        },
      });

      expect(secondResponse.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${secondResponse.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(userResponse.status).toBe(200);
      expect(userResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 40,
          free_trial_abuse: 20,
        },
      });
    });

    it("should continue requiring the visible challenge when the fallback token also fails", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const email = `turnstile-visible-fail-${generateSecureRandomString(8)}@example.com`;
      const password = generateSecureRandomString();

      const firstResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email,
          password,
          turnstile_token: mockTurnstileTokens.invalid,
          turnstile_phase: "invisible",
        },
      });

      expect(firstResponse.status).toBe(409);

      const secondResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email,
          password,
          turnstile_token: mockTurnstileTokens.invalid,
          turnstile_phase: "visible",
          turnstile_previous_result: "invalid",
        },
      });

      expect(secondResponse.status).toBe(409);
      expect(secondResponse.body).toMatchObject({
        code: "TURNSTILE_CHALLENGE_REQUIRED",
        details: {
          invisible_result: "invalid",
        },
      });
    });
  });

  describe("persistence on OTP signup", () => {
    it("should persist risk scores for OTP signup", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { magic_link_enabled: true },
      });

      await Auth.Otp.signIn();

      const meResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "server",
      });
      expect(meResponse.status).toBe(200);

      expect(meResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 0,
          free_trial_abuse: 0,
        },
      });
    });

    it("should persist Turnstile-derived risk scores from the OTP send step", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { magic_link_enabled: true },
      });

      const sendResult = await Auth.Otp.sendSignInCode({
        turnstileToken: mockTurnstileTokens.invalid,
      });
      const signInResult = await Auth.Otp.signInWithCode(
        await Auth.Otp.getSignInCodeFromMailbox(sendResult.sendSignInCodeResponse.body.nonce)
      );

      const userResponse = await niceBackendFetch(`/api/v1/users/${signInResult.userId}`, {
        method: "GET",
        accessType: "server",
      });
      expect(userResponse.status).toBe(200);
      expect(userResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 80,
          free_trial_abuse: 40,
        },
      });
    });
  });

  describe("persistence on OAuth signup", () => {
    it("should persist risk scores for OAuth signup", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          oauth_providers: [{ id: "spotify", type: "shared" }],
        },
      });
      await InternalApiKey.createAndSetProjectKeys();

      const response = await Auth.OAuth.signIn();
      expect(response.tokenResponse.status).toBe(200);

      const meResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "server",
      });
      expect(meResponse.status).toBe(200);

      expect(meResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 0,
          free_trial_abuse: 0,
        },
      });
    });

    it("should persist Turnstile-derived risk scores from OAuth authorize", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          oauth_providers: [{ id: "spotify", type: "shared" }],
        },
      });
      await InternalApiKey.createAndSetProjectKeys();

      const response = await Auth.OAuth.signIn({
        turnstileToken: mockTurnstileTokens.invalid,
      });
      expect(response.tokenResponse.status).toBe(200);

      const meResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "server",
      });
      expect(meResponse.status).toBe(200);
      expect(meResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 80,
          free_trial_abuse: 40,
        },
      });
    });
  });

  describe("persistence on anonymous user conversion", () => {
    it("should persist risk scores when converting anonymous user to password user", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const anonResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
        accessType: "client",
        method: "POST",
        body: {},
      });
      expect(anonResponse.status).toBe(200);

      const accessToken = anonResponse.body.access_token;

      const convertResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        headers: { "x-stack-access-token": accessToken },
        body: {
          email: `convert-${generateSecureRandomString(8)}@example.com`,
          password: generateSecureRandomString(),
        },
      });
      expect(convertResponse.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${convertResponse.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(userResponse.status).toBe(200);
      expect(userResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 0,
          free_trial_abuse: 0,
        },
      });
    });

    it("should persist non-zero risk scores when converting anonymous user with high-risk email", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const anonResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
        accessType: "client",
        method: "POST",
        body: {},
      });
      expect(anonResponse.status).toBe(200);

      const accessToken = anonResponse.body.access_token;

      const convertResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        headers: { "x-stack-access-token": accessToken },
        body: {
          email: "user@emailable-not-deliverable.example.com",
          password: generateSecureRandomString(),
        },
      });
      expect(convertResponse.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${convertResponse.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(userResponse.status).toBe(200);
      expect(userResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 100,
          free_trial_abuse: 100,
        },
      });
    });

    it("should persist Turnstile-derived risk scores when converting an anonymous user", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const anonResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
        accessType: "client",
        method: "POST",
        body: {},
      });
      expect(anonResponse.status).toBe(200);

      const convertResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        headers: { "x-stack-access-token": anonResponse.body.access_token },
        body: {
          email: `convert-turnstile-${generateSecureRandomString(8)}@example.com`,
          password: generateSecureRandomString(),
          turnstile_token: mockTurnstileTokens.invalid,
        },
      });
      expect(convertResponse.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${convertResponse.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });
      expect(userResponse.status).toBe(200);
      expect(userResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 80,
          free_trial_abuse: 40,
        },
      });
    });
  });

  describe("recent-signup heuristics", () => {
    it("should score repeated recent signups from the same spoofable IP", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      backendContext.set({
        ipData: {
          ipAddress: "127.0.0.21",
          country: "US",
          city: "New York",
          region: "NY",
          latitude: 40.7128,
          longitude: -74.006,
          tzIdentifier: "America/New_York",
        },
      });

      const firstResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: `same-ip-first-${generateSecureRandomString(8)}@example.com`,
          password: generateSecureRandomString(),
        },
      });
      expect(firstResponse.status).toBe(200);

      backendContext.set({ userAuth: null });

      const secondResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: `same-ip-second-${generateSecureRandomString(8)}@example.com`,
          password: generateSecureRandomString(),
        },
      });
      expect(secondResponse.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${secondResponse.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(userResponse.status).toBe(200);
      expect(userResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 15,
          free_trial_abuse: 35,
        },
      });
    });

    it("should score recent similar-email signups without matching unrelated emails", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });
      backendContext.set({ ipData: undefined });

      const firstResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: "alice+1@example.com",
          password: generateSecureRandomString(),
        },
      });
      expect(firstResponse.status).toBe(200);

      backendContext.set({ userAuth: null });

      const similarResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: "alice+2@example.com",
          password: generateSecureRandomString(),
        },
      });
      expect(similarResponse.status).toBe(200);

      const similarUserResponse = await niceBackendFetch(`/api/v1/users/${similarResponse.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(similarUserResponse.status).toBe(200);
      expect(similarUserResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 20,
          free_trial_abuse: 60,
        },
      });

      backendContext.set({ userAuth: null });

      const unrelatedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: "alice+sales@example.com",
          password: generateSecureRandomString(),
        },
      });
      expect(unrelatedResponse.status).toBe(200);

      const unrelatedUserResponse = await niceBackendFetch(`/api/v1/users/${unrelatedResponse.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(unrelatedUserResponse.status).toBe(200);
      expect(unrelatedUserResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 0,
          free_trial_abuse: 0,
        },
      });
    });

    it("should persist recent-signup heuristic scores when upgrading an anonymous user", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      backendContext.set({
        ipData: {
          ipAddress: "127.0.0.31",
          country: "CA",
          city: "Toronto",
          region: "ON",
          latitude: 43.6532,
          longitude: -79.3832,
          tzIdentifier: "America/Toronto",
        },
      });

      const firstResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: `upgrade-baseline-${generateSecureRandomString(8)}@example.com`,
          password: generateSecureRandomString(),
        },
      });
      expect(firstResponse.status).toBe(200);

      backendContext.set({ userAuth: null });

      const anonymousResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
        accessType: "client",
        method: "POST",
        body: {},
      });
      expect(anonymousResponse.status).toBe(200);

      const upgradeResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        headers: { "x-stack-access-token": anonymousResponse.body.access_token },
        body: {
          email: `upgrade-target-${generateSecureRandomString(8)}@example.com`,
          password: generateSecureRandomString(),
        },
      });
      expect(upgradeResponse.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${upgradeResponse.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(userResponse.status).toBe(200);
      expect(userResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 15,
          free_trial_abuse: 35,
        },
      });
    });
  });

  describe("signup country persistence", () => {
    it("should keep country_code null when request geo is unavailable", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: "countryless@example.com",
          password: generateSecureRandomString(),
        },
      });
      expect(response.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${response.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(userResponse.status).toBe(200);
      expect(userResponse.body.country_code).toBeNull();
    });

    it("should persist country_code for password signup", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

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

      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: `country-${generateSecureRandomString(8)}@example.com`,
          password: generateSecureRandomString(),
        },
      });
      expect(response.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${response.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(userResponse.status).toBe(200);
      expect(userResponse.body.country_code).toBe("CA");
    });

    it("should persist country_code for OTP signup", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { magic_link_enabled: true },
      });

      backendContext.set({
        ipData: {
          ipAddress: "127.0.0.1",
          country: "DE",
          city: "Berlin",
          region: "BE",
          latitude: 52.52,
          longitude: 13.405,
          tzIdentifier: "Europe/Berlin",
        },
      });

      await Auth.Otp.signIn();

      const meResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "server",
      });

      expect(meResponse.status).toBe(200);
      expect(meResponse.body.country_code).toBe("DE");
    });

    it("should persist country_code for OAuth signup", async ({ expect }) => {
      await Project.createAndSwitch({
        config: {
          oauth_providers: [{ id: "spotify", type: "shared" }],
        },
      });
      await InternalApiKey.createAndSetProjectKeys();

      backendContext.set({
        ipData: {
          ipAddress: "127.0.0.1",
          country: "FR",
          city: "Paris",
          region: "IDF",
          latitude: 48.8566,
          longitude: 2.3522,
          tzIdentifier: "Europe/Paris",
        },
      });

      const response = await Auth.OAuth.signIn();
      expect(response.tokenResponse.status).toBe(200);

      const meResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "server",
      });

      expect(meResponse.status).toBe(200);
      expect(meResponse.body.country_code).toBe("FR");
    });

    it("should keep country_code null for anonymous users", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      backendContext.set({
        ipData: {
          ipAddress: "127.0.0.1",
          country: "US",
          city: "New York",
          region: "NY",
          latitude: 40.7128,
          longitude: -74.006,
          tzIdentifier: "America/New_York",
        },
      });

      const anonResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
        accessType: "client",
        method: "POST",
        body: {},
      });
      expect(anonResponse.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${anonResponse.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(userResponse.status).toBe(200);
      expect(userResponse.body.country_code).toBeNull();
    });
  });

  // ==========================================
  // ANONYMOUS USERS
  // ==========================================

  describe("anonymous users", () => {
    it("should have zero risk scores for anonymous users (rules not evaluated)", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const anonResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
        accessType: "client",
        method: "POST",
        body: {},
      });
      expect(anonResponse.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${anonResponse.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(userResponse.status).toBe(200);
      expect(userResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 0,
          free_trial_abuse: 0,
        },
      });
    });
  });

  // ==========================================
  // SERVER API VISIBILITY
  // ==========================================

  describe("API visibility", () => {
    it("should include risk_scores in server user response", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const res = await Auth.Password.signUpWithEmail();

      const serverResponse = await niceBackendFetch(`/api/v1/users/${res.userId}`, {
        method: "GET",
        accessType: "server",
      });

      expect(serverResponse.status).toBe(200);
      expect(serverResponse.body).toHaveProperty("risk_scores");
      expect(serverResponse.body.risk_scores).toHaveProperty("sign_up");
      expect(serverResponse.body.risk_scores.sign_up).toHaveProperty("bot");
      expect(serverResponse.body.risk_scores.sign_up).toHaveProperty("free_trial_abuse");
    });

    it("should NOT include risk_scores in client user response", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      await Auth.Password.signUpWithEmail();

      const clientResponse = await niceBackendFetch("/api/v1/users/me", {
        accessType: "client",
      });

      expect(clientResponse.status).toBe(200);
      expect(clientResponse.body).not.toHaveProperty("risk_scores");
    });

    it("should include risk_scores in user list response (server access)", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      await Auth.Password.signUpWithEmail();

      const listResponse = await niceBackendFetch("/api/v1/users", {
        accessType: "server",
      });

      expect(listResponse.status).toBe(200);
      expect(listResponse.body.items.length).toBeGreaterThan(0);
      expect(listResponse.body.items[0]).toHaveProperty("risk_scores");
      expect(listResponse.body.items[0].risk_scores.sign_up).toHaveProperty("bot");
      expect(listResponse.body.items[0].risk_scores.sign_up).toHaveProperty("free_trial_abuse");
    });
  });

  // ==========================================
  // SERVER-SIDE UPDATE
  // ==========================================

  describe("server-side update", () => {
    it("should allow risk_scores in server update requests", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const res = await Auth.Password.signUpWithEmail();

      const updateResponse = await niceBackendFetch(`/api/v1/users/${res.userId}`, {
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

      const readResponse = await niceBackendFetch(`/api/v1/users/${res.userId}`, {
        method: "GET",
        accessType: "server",
      });
      expect(readResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 75,
          free_trial_abuse: 30,
        },
      });
    });

    it("should reject risk scores out of range (> 100)", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const res = await Auth.Password.signUpWithEmail();

      const response = await niceBackendFetch(`/api/v1/users/${res.userId}`, {
        method: "PATCH",
        accessType: "server",
        body: {
          risk_scores: {
            sign_up: {
              bot: 150,
              free_trial_abuse: 0,
            },
          },
        },
      });

      expect(response.status).toBe(400);
    });

    it("should reject risk scores out of range (< 0)", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const res = await Auth.Password.signUpWithEmail();

      const response = await niceBackendFetch(`/api/v1/users/${res.userId}`, {
        method: "PATCH",
        accessType: "server",
        body: {
          risk_scores: {
            sign_up: {
              bot: -10,
              free_trial_abuse: 0,
            },
          },
        },
      });

      expect(response.status).toBe(400);
    });

    it("should allow country_code in server update requests", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const res = await Auth.Password.signUpWithEmail();

      const response = await niceBackendFetch(`/api/v1/users/${res.userId}`, {
        method: "PATCH",
        accessType: "server",
        body: {
          country_code: "FR",
        },
      });

      expect(response.status).toBe(200);
      expect(response.body.country_code).toBe("FR");
    });

    it("should reject non-integer risk scores", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const res = await Auth.Password.signUpWithEmail();

      const response = await niceBackendFetch(`/api/v1/users/${res.userId}`, {
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

      expect(response.status).toBe(400);
    });

    it("should not change risk scores when updating other user fields", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: "user@tempmail.com",
          password: generateSecureRandomString(),
        },
      });
      expect(response.status).toBe(200);

      const userId = response.body.user_id;

      const updateResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
        method: "PATCH",
        accessType: "server",
        body: {
          display_name: "Updated Name",
        },
      });
      expect(updateResponse.status).toBe(200);

      expect(updateResponse.body.display_name).toBe("Updated Name");
      expect(updateResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 100,
          free_trial_abuse: 100,
        },
      });
    });
  });

  describe("client-side access", () => {
    it("should reject client attempts to update risk_scores on the current user", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const signUpResult = await Auth.Password.signUpWithEmail({
        noWaitForEmail: true,
        turnstileToken: mockTurnstileTokens.invalid,
      });
      expect(signUpResult.signUpResponse.status).toBe(200);

      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        method: "PATCH",
        accessType: "client",
        body: {
          risk_scores: {
            sign_up: {
              bot: 0,
              free_trial_abuse: 0,
            },
          },
        },
      });
      expect(updateResponse.status).toBe(400);

      const readResponse = await niceBackendFetch(`/api/v1/users/${signUpResult.userId}`, {
        method: "GET",
        accessType: "server",
      });
      expect(readResponse.status).toBe(200);
      expect(readResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 80,
          free_trial_abuse: 40,
        },
      });
    });
  });

  // ==========================================
  // RISK SCORES + SIGN-UP RULES INTERACTION
  // ==========================================

  describe("interaction with sign-up rules", () => {
    it("should restrict user based on risk score CEL condition", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      await Project.updateConfig({
        'auth.signUpRules.restrict-high-bot': {
          enabled: true,
          displayName: 'Restrict high bot score',
          priority: 0,
          condition: 'riskScores.bot >= 80',
          action: { type: 'restrict' },
        },
        'auth.signUpRulesDefaultAction': 'allow',
      });

      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: "user@tempmail.com",
          password: generateSecureRandomString(),
        },
      });
      expect(response.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${response.body.user_id}`, {
        method: "GET",
        accessType: "server",
      });

      expect(userResponse.body.restricted_by_admin).toBe(true);
      expect(userResponse.body.risk_scores.sign_up.bot).toBe(100);
    });

    it("should reject user based on risk score CEL condition", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      await Project.updateConfig({
        'auth.signUpRules.reject-high-risk': {
          enabled: true,
          displayName: 'Reject high risk',
          priority: 0,
          condition: 'riskScores.bot >= 80 && riskScores.freeTrialAbuse >= 80',
          action: { type: 'reject' },
        },
        'auth.signUpRulesDefaultAction': 'allow',
      });

      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: "user@tempmail.com",
          password: generateSecureRandomString(),
        },
      });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("SIGN_UP_REJECTED");
    });

    it("should allow user when risk score is below threshold", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      await Project.updateConfig({
        'auth.signUpRules.reject-high-bot': {
          enabled: true,
          displayName: 'Reject high bot score',
          priority: 0,
          condition: 'riskScores.bot >= 80',
          action: { type: 'reject' },
        },
        'auth.signUpRulesDefaultAction': 'allow',
      });

      const res = await Auth.Password.signUpWithEmail();
      expect(res.signUpResponse.status).toBe(200);
    });

    it("should reject a Turnstile-invalid signup when rules block bot scores >= 80", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      await Project.updateConfig({
        'auth.signUpRules.reject-high-bot': {
          enabled: true,
          displayName: 'Reject high bot score',
          priority: 0,
          condition: 'riskScores.bot >= 80',
          action: { type: 'reject' },
        },
        'auth.signUpRulesDefaultAction': 'allow',
      });

      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: `turnstile-rule-${generateSecureRandomString(8)}@example.com`,
          password: generateSecureRandomString(),
          turnstile_token: mockTurnstileTokens.invalid,
        },
      });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("SIGN_UP_REJECTED");
    });
  });

  // ==========================================
  // SERVER-CREATED USERS
  // ==========================================

  describe("server-created users", () => {
    it("should default risk scores to 0 for server-created users", async ({ expect }) => {
      const createResponse = await niceBackendFetch("/api/v1/users", {
        method: "POST",
        accessType: "server",
        body: {
          primary_email: `server-created-${generateSecureRandomString(8)}@example.com`,
        },
      });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.risk_scores).toEqual({
        sign_up: {
          bot: 0,
          free_trial_abuse: 0,
        },
      });
    });

    it("should allow risk_scores and country_code when creating users via server API", async ({ expect }) => {
      const createResponse = await niceBackendFetch("/api/v1/users", {
        method: "POST",
        accessType: "server",
        body: {
          primary_email: `risky-${generateSecureRandomString(8)}@example.com`,
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
  });
});
