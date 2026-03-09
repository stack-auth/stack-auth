import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { describe } from "vitest";
import { it } from "../../../../helpers";
import { Auth, InternalApiKey, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";

describe("risk scores", () => {
  // ==========================================
  // PERSISTENCE ON SIGNUP
  // ==========================================

  describe("persistence on password signup", () => {
    it("should persist non-zero risk scores for high-risk email (test@example.com stub)", async ({ expect }) => {
      await Project.createAndSwitch({
        config: { credential_enabled: true },
      });

      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: "test@example.com",
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

      const res = await Auth.Password.signUpWithEmail();
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
          email: "test@example.com",
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
          email: "test@example.com",
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
          email: "test@example.com",
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
          email: "test@example.com",
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
