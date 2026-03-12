import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { describe } from "vitest";
import { it } from "../../../../helpers";
import { Auth, InternalApiKey, Project, backendContext, mockTurnstileTokens, niceBackendFetch } from "../../../backend-helpers";

// ────────────────────────────────────────────────────────────────────────────────
// Hardcoded expected scores.  These are regression anchors — NOT derived from
// the weight code.  If the weights change, update these numbers by hand after
// verifying the new behaviour is correct.
// ────────────────────────────────────────────────────────────────────────────────

const EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN = "emailable-not-deliverable.example.com";

const TRUSTED_IP_FIXTURE = {
  ipAddress: "127.0.0.50",
  country: "US",
  city: "New York",
  region: "NY",
  latitude: 40.7128,
  longitude: -74.006,
  tzIdentifier: "America/New_York",
} as const;


// ── Helpers ──────────────────────────────────────────────────────────────────

type Scores = { bot: number, free_trial_abuse: number };

async function passwordSignUp(options: {
  email?: string,
  turnstileToken?: string,
  turnstilePhase?: string,
  previousTurnstileResult?: string,
  accessTokenOverride?: string,
}): Promise<string> {
  const email = options.email ?? `matrix-${generateSecureRandomString(8)}@example.com`;
  const body: Record<string, string> = {
    email,
    password: generateSecureRandomString(),
  };
  if (options.turnstileToken != null) body.turnstile_token = options.turnstileToken;
  if (options.turnstilePhase != null) body.turnstile_phase = options.turnstilePhase;
  if (options.previousTurnstileResult != null) body.turnstile_previous_result = options.previousTurnstileResult;

  const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
    method: "POST",
    accessType: "client",
    ...(options.accessTokenOverride != null ? { headers: { "x-stack-access-token": options.accessTokenOverride } } : {}),
    body,
  });

  if (response.status !== 200) {
    throw new Error(`password sign-up failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body.user_id;
}

async function readUserScores(userId: string): Promise<Scores> {
  const response = await niceBackendFetch(`/api/v1/users/${userId}`, {
    method: "GET",
    accessType: "server",
  });
  return response.body.risk_scores.sign_up;
}

async function signUpReadScoresAndLogout(options: {
  email?: string,
  turnstileToken?: string,
}): Promise<Scores> {
  const userId = await passwordSignUp(options);
  const scores = await readUserScores(userId);
  backendContext.set({ userAuth: null });
  return scores;
}

function logRow(label: string, actual: Scores, expected: Scores) {
  const match = actual.bot === expected.bot && actual.free_trial_abuse === expected.free_trial_abuse;
  const tag = match ? "OK" : "MISMATCH";
  console.log(
    `  [${tag}] ${label.padEnd(60)} `
    + `actual { bot: ${String(actual.bot).padStart(3)}, fta: ${String(actual.free_trial_abuse).padStart(3)} } `
    + `expected { bot: ${String(expected.bot).padStart(3)}, fta: ${String(expected.free_trial_abuse).padStart(3)} }`
  );
}

function assertScores(expect: any, label: string, actual: Scores, expected: Scores) {
  logRow(label, actual, expected);
  expect(actual).toEqual(expected);
}


// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("risk scores", () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 1. SCORING MATRIX — individual signals and key combinations
  //
  //    All expected values are hardcoded integers.  They serve as regression
  //    anchors so we catch any unintentional weight / logic changes.
  // ──────────────────────────────────────────────────────────────────────────

  describe("scoring matrix: turnstile signal (isolated)", () => {
    it("turnstile ok", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const s = await signUpReadScoresAndLogout({ turnstileToken: mockTurnstileTokens.signUpOk });
      assertScores(expect, "turnstile ok", s, { bot: 0, free_trial_abuse: 0 });
    });

    it("turnstile invalid", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const s = await signUpReadScoresAndLogout({ turnstileToken: mockTurnstileTokens.invalid });
      assertScores(expect, "turnstile invalid", s, { bot: 20, free_trial_abuse: 20 });
    });

    it("turnstile error", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const s = await signUpReadScoresAndLogout({ turnstileToken: mockTurnstileTokens.error });
      assertScores(expect, "turnstile error", s, { bot: 0, free_trial_abuse: 0 });
    });

    it("turnstile omitted (legacy backward compat)", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const s = await signUpReadScoresAndLogout({});
      assertScores(expect, "turnstile omitted (legacy)", s, { bot: 20, free_trial_abuse: 20 });
    });
  });

  describe("scoring matrix: emailable signal", () => {
    it("not-deliverable domain (emailable score 0) + turnstile omitted", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const s = await signUpReadScoresAndLogout({
        email: `user@${EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN}`,
      });
      assertScores(expect, "emailable not-deliverable + turnstile omitted", s, { bot: 65, free_trial_abuse: 55 });
    });
  });

  describe("scoring matrix: same-IP escalation (trusted IP)", () => {
    it("scores ramp linearly from 1→3 prior signups then clamp", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      backendContext.set({ ipData: { ...TRUSTED_IP_FIXTURE, ipAddress: "127.0.0.60" } });

      console.log("\n  ── same-IP escalation (trusted, turnstile omitted) ──");

      // Seed: 1st signup establishes the IP baseline (no prior same-IP → turnstile-only)
      const seed = await signUpReadScoresAndLogout({});
      assertScores(expect, "seed (0 prior)", seed, { bot: 20, free_trial_abuse: 20 });

      // 1 prior same-IP signup  →  IP contributes 1/3 of trusted weight
      const s1 = await signUpReadScoresAndLogout({});
      assertScores(expect, "1 prior same-IP", s1, { bot: 28, free_trial_abuse: 32 });

      // 2 prior  →  2/3 of trusted weight
      const s2 = await signUpReadScoresAndLogout({});
      assertScores(expect, "2 prior same-IP", s2, { bot: 37, free_trial_abuse: 43 });

      // 3 prior  →  full trusted weight (max)
      const s3 = await signUpReadScoresAndLogout({});
      assertScores(expect, "3 prior same-IP (max)", s3, { bot: 45, free_trial_abuse: 55 });

      // 4 prior  →  still clamped at full trusted weight
      const s4 = await signUpReadScoresAndLogout({});
      assertScores(expect, "4 prior same-IP (clamped)", s4, { bot: 45, free_trial_abuse: 55 });
    });
  });

  describe("scoring matrix: similar email", () => {
    it("plus-alias triggers similar email, truly different base does not", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      backendContext.set({ ipData: undefined });

      console.log("\n  ── similar email (no IP, turnstile omitted) ──");

      // Seed
      await signUpReadScoresAndLogout({ email: "alice+1@example.com" });

      // Same base (alice@example.com) → triggers similar email signal
      const similar = await signUpReadScoresAndLogout({ email: "alice+2@example.com" });
      assertScores(expect, "alice+2 after alice+1 (same base)", similar, { bot: 30, free_trial_abuse: 30 });

      // Different base (bob@example.com) → no similar email signal
      const unrelated = await signUpReadScoresAndLogout({ email: "bob@example.com" });
      assertScores(expect, "bob after alice (different base)", unrelated, { bot: 20, free_trial_abuse: 20 });
    });

    it("non-numeric plus suffixes also share the same base", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      backendContext.set({ ipData: undefined });

      console.log("\n  ── similar email: non-numeric plus tags ──");

      await signUpReadScoresAndLogout({ email: "demo+abc12345@example.com" });

      const similar = await signUpReadScoresAndLogout({ email: "demo+xyz67890@example.com" });
      assertScores(expect, "demo+xyz after demo+abc (same base)", similar, { bot: 30, free_trial_abuse: 30 });
    });
  });

  describe("scoring matrix: combined signals", () => {
    it("turnstile ok + trusted IP x3 + similar email", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      backendContext.set({ ipData: { ...TRUSTED_IP_FIXTURE, ipAddress: "127.0.0.61" } });

      console.log("\n  ── combo: turnstile ok + IP x3 + similar email ──");

      // Seed 3 users (same IP, same email base)
      await signUpReadScoresAndLogout({ email: "combo+1@example.com", turnstileToken: mockTurnstileTokens.signUpOk });
      await signUpReadScoresAndLogout({ email: "combo+2@example.com", turnstileToken: mockTurnstileTokens.signUpOk });
      await signUpReadScoresAndLogout({ email: "combo+3@example.com", turnstileToken: mockTurnstileTokens.signUpOk });

      const target = await signUpReadScoresAndLogout({ email: "combo+4@example.com", turnstileToken: mockTurnstileTokens.signUpOk });
      // turnstile ok (0,0) + IP trusted x3 (25,35) + similar email (10,10) = (35, 45)
      assertScores(expect, "turnstile ok + IP x3 + similar", target, { bot: 35, free_trial_abuse: 45 });
    });

    it("turnstile invalid + trusted IP x3 + similar email", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      backendContext.set({ ipData: { ...TRUSTED_IP_FIXTURE, ipAddress: "127.0.0.62" } });

      console.log("\n  ── combo: turnstile invalid + IP x3 + similar email ──");

      await signUpReadScoresAndLogout({ email: "comboB+1@example.com" });
      await signUpReadScoresAndLogout({ email: "comboB+2@example.com" });
      await signUpReadScoresAndLogout({ email: "comboB+3@example.com" });

      const target = await signUpReadScoresAndLogout({ email: "comboB+4@example.com" });
      // turnstile inv (20,20) + IP x3 (25,35) + similar (10,10) = (55, 65)
      assertScores(expect, "turnstile inv + IP x3 + similar", target, { bot: 55, free_trial_abuse: 65 });
    });

    it("all signals maxed → clamped at {100, 100}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      backendContext.set({ ipData: { ...TRUSTED_IP_FIXTURE, ipAddress: "127.0.0.63" } });

      console.log("\n  ── combo: all signals maxed ──");

      const domain = EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN;
      await signUpReadScoresAndLogout({ email: `allmax+1@${domain}` });
      await signUpReadScoresAndLogout({ email: `allmax+2@${domain}` });
      await signUpReadScoresAndLogout({ email: `allmax+3@${domain}` });

      const target = await signUpReadScoresAndLogout({ email: `allmax+4@${domain}` });
      // turnstile inv (20,20) + emailable (45,35) + IP x3 (25,35) + similar (10,10) = (100, 100)
      assertScores(expect, "all signals maxed", target, { bot: 100, free_trial_abuse: 100 });
    });

    it("emailable not-deliverable + similar email + turnstile omitted (no IP)", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      backendContext.set({ ipData: undefined });

      console.log("\n  ── combo: emailable + similar email (no IP) ──");

      const domain = EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN;
      await signUpReadScoresAndLogout({ email: `emailsim+1@${domain}` });

      const target = await signUpReadScoresAndLogout({ email: `emailsim+2@${domain}` });
      // turnstile inv (20,20) + emailable (45,35) + similar (10,10) = (75, 65)
      assertScores(expect, "emailable + similar (no IP)", target, { bot: 75, free_trial_abuse: 65 });
    });
  });


  // ──────────────────────────────────────────────────────────────────────────
  // 2. AUTH METHOD PARITY — verify OTP and OAuth produce the same scoring
  // ──────────────────────────────────────────────────────────────────────────

  describe("auth method parity", () => {
    it("OTP with valid turnstile → {0, 0}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { magic_link_enabled: true } });

      await Auth.Otp.signIn();

      const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: "server" });
      expect(meResponse.status).toBe(200);
      assertScores(expect, "OTP + turnstile ok", meResponse.body.risk_scores.sign_up, { bot: 0, free_trial_abuse: 0 });
    });

    it("OTP with invalid turnstile → {20, 10}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { magic_link_enabled: true } });

      const sendResult = await Auth.Otp.sendSignInCode({ turnstileToken: mockTurnstileTokens.invalid });
      const signInResult = await Auth.Otp.signInWithCode(
        await Auth.Otp.getSignInCodeFromMailbox(sendResult.sendSignInCodeResponse.body.nonce)
      );

      const userResponse = await niceBackendFetch(`/api/v1/users/${signInResult.userId}`, { method: "GET", accessType: "server" });
      expect(userResponse.status).toBe(200);
      assertScores(expect, "OTP + turnstile invalid", userResponse.body.risk_scores.sign_up, { bot: 20, free_trial_abuse: 20 });
    });

    it("OAuth with valid turnstile → {0, 0}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { oauth_providers: [{ id: "spotify", type: "shared" }] } });
      await InternalApiKey.createAndSetProjectKeys();

      const response = await Auth.OAuth.signIn();
      expect(response.tokenResponse.status).toBe(200);

      const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: "server" });
      expect(meResponse.status).toBe(200);
      assertScores(expect, "OAuth + turnstile ok", meResponse.body.risk_scores.sign_up, { bot: 0, free_trial_abuse: 0 });
    });

    it("OAuth with invalid turnstile → {20, 10}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { oauth_providers: [{ id: "spotify", type: "shared" }] } });
      await InternalApiKey.createAndSetProjectKeys();

      const response = await Auth.OAuth.signIn({ turnstileToken: mockTurnstileTokens.invalid });
      expect(response.tokenResponse.status).toBe(200);

      const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: "server" });
      expect(meResponse.status).toBe(200);
      assertScores(expect, "OAuth + turnstile invalid", meResponse.body.risk_scores.sign_up, { bot: 20, free_trial_abuse: 20 });
    });
  });


  // ──────────────────────────────────────────────────────────────────────────
  // 3. TURNSTILE CHALLENGE FLOW — invisible→visible recovery & failures
  // ──────────────────────────────────────────────────────────────────────────

  describe("turnstile challenge flow", () => {
    it("password: invisible ok → signup succeeds immediately with {0, 0}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const email = `ts-inv-ok-${generateSecureRandomString(8)}@example.com`;
      const userId = await passwordSignUp({ email, turnstileToken: mockTurnstileTokens.signUpOk, turnstilePhase: "invisible" });
      const scores = await readUserScores(userId);
      assertScores(expect, "password invisible ok", scores, { bot: 0, free_trial_abuse: 0 });
    });

    it("password: invisible invalid → 409, then visible ok → signup with {20, 10}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const email = `ts-recovered-${generateSecureRandomString(8)}@example.com`;
      const password = generateSecureRandomString();

      const firstResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: { email, password, turnstile_token: mockTurnstileTokens.invalid, turnstile_phase: "invisible" },
      });
      expect(firstResponse.status).toBe(409);
      expect(firstResponse.body).toMatchObject({ code: "TURNSTILE_CHALLENGE_REQUIRED", details: { invisible_result: "invalid" } });

      const secondResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email, password,
          turnstile_token: mockTurnstileTokens.visibleSignUpOk,
          turnstile_phase: "visible",
          turnstile_previous_result: "invalid",
        },
      });
      expect(secondResponse.status).toBe(200);

      const scores = await readUserScores(secondResponse.body.user_id);
      assertScores(expect, "password invisible→visible recovery", scores, { bot: 20, free_trial_abuse: 20 });
    });

    it("password: invisible invalid → visible also invalid → 409 again", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const email = `ts-both-fail-${generateSecureRandomString(8)}@example.com`;
      const password = generateSecureRandomString();

      const firstResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: { email, password, turnstile_token: mockTurnstileTokens.invalid, turnstile_phase: "invisible" },
      });
      expect(firstResponse.status).toBe(409);

      const secondResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email, password,
          turnstile_token: mockTurnstileTokens.invalid,
          turnstile_phase: "visible",
          turnstile_previous_result: "invalid",
        },
      });
      expect(secondResponse.status).toBe(409);
      expect(secondResponse.body).toMatchObject({ code: "TURNSTILE_CHALLENGE_REQUIRED" });
    });

    it("OTP: invisible ok → sends code successfully with {0, 0}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { magic_link_enabled: true } });

      const sendResult = await Auth.Otp.sendSignInCode({ turnstileToken: mockTurnstileTokens.magicLinkOk, turnstilePhase: "invisible" });
      const signInResult = await Auth.Otp.signInWithCode(
        await Auth.Otp.getSignInCodeFromMailbox(sendResult.sendSignInCodeResponse.body.nonce)
      );

      const userResponse = await niceBackendFetch(`/api/v1/users/${signInResult.userId}`, { method: "GET", accessType: "server" });
      expect(userResponse.status).toBe(200);
      assertScores(expect, "OTP invisible ok", userResponse.body.risk_scores.sign_up, { bot: 0, free_trial_abuse: 0 });
    });

    it("OTP: invisible invalid → 409, then visible ok → {20, 10}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { magic_link_enabled: true } });

      const challengeResponse = await niceBackendFetch("/api/v1/auth/otp/send-sign-in-code", {
        method: "POST",
        accessType: "client",
        body: {
          email: backendContext.value.mailbox.emailAddress,
          callback_url: "http://localhost:12345/some-callback-url",
          turnstile_token: mockTurnstileTokens.invalid,
          turnstile_phase: "invisible",
        },
      });
      expect(challengeResponse.status).toBe(409);
      expect(challengeResponse.body).toMatchObject({ code: "TURNSTILE_CHALLENGE_REQUIRED" });

      const sendResult = await Auth.Otp.sendSignInCode({
        turnstileToken: mockTurnstileTokens.visibleMagicLinkOk,
        turnstilePhase: "visible",
        previousTurnstileResult: "invalid",
      });
      const signInResult = await Auth.Otp.signInWithCode(
        await Auth.Otp.getSignInCodeFromMailbox(sendResult.sendSignInCodeResponse.body.nonce)
      );

      const userResponse = await niceBackendFetch(`/api/v1/users/${signInResult.userId}`, { method: "GET", accessType: "server" });
      expect(userResponse.status).toBe(200);
      assertScores(expect, "OTP invisible→visible recovery", userResponse.body.risk_scores.sign_up, { bot: 20, free_trial_abuse: 20 });
    });

    it("OTP: visible phase without previous_result → 400 SCHEMA_ERROR", async ({ expect }) => {
      await Project.createAndSwitch({ config: { magic_link_enabled: true } });

      const response = await niceBackendFetch("/api/v1/auth/otp/send-sign-in-code", {
        method: "POST",
        accessType: "client",
        body: {
          email: backendContext.value.mailbox.emailAddress,
          callback_url: "http://localhost:12345/some-callback-url",
          turnstile_token: mockTurnstileTokens.visibleMagicLinkOk,
          turnstile_phase: "visible",
        },
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("SCHEMA_ERROR");
    });

    it("OAuth: invisible ok → signup succeeds with {0, 0}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { oauth_providers: [{ id: "spotify", type: "shared" }] } });
      await InternalApiKey.createAndSetProjectKeys();

      const response = await Auth.OAuth.signIn({ turnstileToken: mockTurnstileTokens.oauthOk, turnstilePhase: "invisible" });
      expect(response.tokenResponse.status).toBe(200);

      const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: "server" });
      expect(meResponse.status).toBe(200);
      assertScores(expect, "OAuth invisible ok", meResponse.body.risk_scores.sign_up, { bot: 0, free_trial_abuse: 0 });
    });

    it("OAuth: invisible invalid → 409, then visible ok → {20, 10}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { oauth_providers: [{ id: "spotify", type: "shared" }] } });
      await InternalApiKey.createAndSetProjectKeys();

      const challengeResponse = await niceBackendFetch("/api/v1/auth/oauth/authorize/spotify", {
        redirect: "manual",
        query: {
          ...await Auth.OAuth.getAuthorizeQuery({ turnstileToken: mockTurnstileTokens.invalid, turnstilePhase: "invisible" }),
        },
      });
      expect(challengeResponse.status).toBe(409);
      expect(challengeResponse.body).toMatchObject({ code: "TURNSTILE_CHALLENGE_REQUIRED" });

      const response = await Auth.OAuth.signIn({
        turnstileToken: mockTurnstileTokens.visibleOAuthOk,
        turnstilePhase: "visible",
        previousTurnstileResult: "invalid",
      });
      expect(response.tokenResponse.status).toBe(200);

      const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: "server" });
      expect(meResponse.status).toBe(200);
      assertScores(expect, "OAuth invisible→visible recovery", meResponse.body.risk_scores.sign_up, { bot: 20, free_trial_abuse: 20 });
    });

    it("OAuth: visible phase without previous_result → 400 SCHEMA_ERROR", async ({ expect }) => {
      await Project.createAndSwitch({ config: { oauth_providers: [{ id: "spotify", type: "shared" }] } });
      await InternalApiKey.createAndSetProjectKeys();

      const response = await niceBackendFetch("/api/v1/auth/oauth/authorize/spotify", {
        redirect: "manual",
        query: {
          ...await Auth.OAuth.getAuthorizeQuery({ turnstileToken: mockTurnstileTokens.visibleOAuthOk, turnstilePhase: "visible" }),
        },
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("SCHEMA_ERROR");
    });
  });


  // ──────────────────────────────────────────────────────────────────────────
  // 4. ANONYMOUS USER CONVERSION
  // ──────────────────────────────────────────────────────────────────────────

  describe("anonymous user conversion", () => {
    it("anonymous → password with turnstile omitted → {20, 10}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });

      const anonResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
        accessType: "client", method: "POST", body: {},
      });
      expect(anonResponse.status).toBe(200);

      const userId = await passwordSignUp({
        email: `convert-${generateSecureRandomString(8)}@example.com`,
        accessTokenOverride: anonResponse.body.access_token,
      });

      const scores = await readUserScores(userId);
      assertScores(expect, "anon → password (turnstile omitted)", scores, { bot: 20, free_trial_abuse: 20 });
    });

    it("anonymous → password with emailable not-deliverable + turnstile omitted → {65, 50}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });

      const anonResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
        accessType: "client", method: "POST", body: {},
      });
      expect(anonResponse.status).toBe(200);

      const userId = await passwordSignUp({
        email: `user@${EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN}`,
        accessTokenOverride: anonResponse.body.access_token,
      });

      const scores = await readUserScores(userId);
      assertScores(expect, "anon → password (emailable bad)", scores, { bot: 65, free_trial_abuse: 55 });
    });

    it("anonymous → password with same-IP prior (trusted) → turnstile omitted + IP", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      backendContext.set({ ipData: { ...TRUSTED_IP_FIXTURE, ipAddress: "127.0.0.64" } });

      // Seed one prior signup from same IP
      await signUpReadScoresAndLogout({});

      const anonResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
        accessType: "client", method: "POST", body: {},
      });
      expect(anonResponse.status).toBe(200);

      const userId = await passwordSignUp({
        email: `convert-ip-${generateSecureRandomString(8)}@example.com`,
        accessTokenOverride: anonResponse.body.access_token,
      });

      const scores = await readUserScores(userId);
      // turnstile inv (20,20) + IP trusted x1 (8,12) = (28, 32)
      assertScores(expect, "anon → password (IP trusted x1)", scores, { bot: 28, free_trial_abuse: 32 });
    });

    it("anonymous user without conversion has {0, 0}", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });

      const anonResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
        accessType: "client", method: "POST", body: {},
      });
      expect(anonResponse.status).toBe(200);

      const scores = await readUserScores(anonResponse.body.user_id);
      assertScores(expect, "anonymous (no conversion)", scores, { bot: 0, free_trial_abuse: 0 });
    });
  });


  // ──────────────────────────────────────────────────────────────────────────
  // 5. COUNTRY CODE PERSISTENCE
  // ──────────────────────────────────────────────────────────────────────────

  describe("country code persistence", () => {
    it("null when geo unavailable", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const userId = await passwordSignUp({});
      const response = await niceBackendFetch(`/api/v1/users/${userId}`, { method: "GET", accessType: "server" });
      expect(response.body.country_code).toBeNull();
    });

    it("persisted from password signup", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      backendContext.set({ ipData: { ...TRUSTED_IP_FIXTURE, ipAddress: "127.0.0.1", country: "CA", city: "Toronto", region: "ON", latitude: 43.6532, longitude: -79.3832, tzIdentifier: "America/Toronto" } });

      const userId = await passwordSignUp({ email: `country-${generateSecureRandomString(8)}@example.com` });
      const response = await niceBackendFetch(`/api/v1/users/${userId}`, { method: "GET", accessType: "server" });
      expect(response.body.country_code).toBe("CA");
    });

    it("persisted from OTP signup", async ({ expect }) => {
      await Project.createAndSwitch({ config: { magic_link_enabled: true } });
      backendContext.set({ ipData: { ...TRUSTED_IP_FIXTURE, ipAddress: "127.0.0.1", country: "DE", city: "Berlin", region: "BE", latitude: 52.52, longitude: 13.405, tzIdentifier: "Europe/Berlin" } });

      await Auth.Otp.signIn();
      const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: "server" });
      expect(meResponse.body.country_code).toBe("DE");
    });

    it("persisted from OAuth signup", async ({ expect }) => {
      await Project.createAndSwitch({ config: { oauth_providers: [{ id: "spotify", type: "shared" }] } });
      await InternalApiKey.createAndSetProjectKeys();
      backendContext.set({ ipData: { ...TRUSTED_IP_FIXTURE, ipAddress: "127.0.0.1", country: "FR", city: "Paris", region: "IDF", latitude: 48.8566, longitude: 2.3522, tzIdentifier: "Europe/Paris" } });

      await Auth.OAuth.signIn();
      const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: "server" });
      expect(meResponse.body.country_code).toBe("FR");
    });

    it("null for anonymous users", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      backendContext.set({ ipData: TRUSTED_IP_FIXTURE });

      const anonResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
        accessType: "client", method: "POST", body: {},
      });
      expect(anonResponse.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${anonResponse.body.user_id}`, { method: "GET", accessType: "server" });
      expect(userResponse.body.country_code).toBeNull();
    });
  });


  // ──────────────────────────────────────────────────────────────────────────
  // 6. API VISIBILITY & ACCESS CONTROL
  // ──────────────────────────────────────────────────────────────────────────

  describe("API visibility", () => {
    it("server response includes risk_scores with bot and free_trial_abuse", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const res = await Auth.Password.signUpWithEmail();

      const serverResponse = await niceBackendFetch(`/api/v1/users/${res.userId}`, { method: "GET", accessType: "server" });
      expect(serverResponse.status).toBe(200);
      expect(serverResponse.body.risk_scores.sign_up).toHaveProperty("bot");
      expect(serverResponse.body.risk_scores.sign_up).toHaveProperty("free_trial_abuse");
    });

    it("client response does NOT include risk_scores", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      await Auth.Password.signUpWithEmail();

      const clientResponse = await niceBackendFetch("/api/v1/users/me", { accessType: "client" });
      expect(clientResponse.status).toBe(200);
      expect(clientResponse.body).not.toHaveProperty("risk_scores");
    });

    it("server list response includes risk_scores", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      await Auth.Password.signUpWithEmail();

      const listResponse = await niceBackendFetch("/api/v1/users", { accessType: "server" });
      expect(listResponse.status).toBe(200);
      expect(listResponse.body.items.length).toBeGreaterThan(0);
      expect(listResponse.body.items[0].risk_scores.sign_up).toHaveProperty("bot");
      expect(listResponse.body.items[0].risk_scores.sign_up).toHaveProperty("free_trial_abuse");
    });

    it("client cannot update risk_scores", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const signUpResult = await Auth.Password.signUpWithEmail({ noWaitForEmail: true, turnstileToken: mockTurnstileTokens.invalid });

      const updateResponse = await niceBackendFetch("/api/v1/users/me", {
        method: "PATCH",
        accessType: "client",
        body: { risk_scores: { sign_up: { bot: 0, free_trial_abuse: 0 } } },
      });
      expect(updateResponse.status).toBe(400);

      const readResponse = await niceBackendFetch(`/api/v1/users/${signUpResult.userId}`, { method: "GET", accessType: "server" });
      assertScores(expect, "unchanged after client PATCH attempt", readResponse.body.risk_scores.sign_up, { bot: 20, free_trial_abuse: 20 });
    });
  });


  // ──────────────────────────────────────────────────────────────────────────
  // 7. SERVER-SIDE CRUD
  // ──────────────────────────────────────────────────────────────────────────

  describe("server-side CRUD", () => {
    it("server can update risk_scores", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const res = await Auth.Password.signUpWithEmail();

      const updateResponse = await niceBackendFetch(`/api/v1/users/${res.userId}`, {
        method: "PATCH",
        accessType: "server",
        body: { risk_scores: { sign_up: { bot: 75, free_trial_abuse: 30 } } },
      });
      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.risk_scores).toEqual({ sign_up: { bot: 75, free_trial_abuse: 30 } });

      const readResponse = await niceBackendFetch(`/api/v1/users/${res.userId}`, { method: "GET", accessType: "server" });
      expect(readResponse.body.risk_scores).toEqual({ sign_up: { bot: 75, free_trial_abuse: 30 } });
    });

    it("rejects risk scores > 100", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const res = await Auth.Password.signUpWithEmail();
      const response = await niceBackendFetch(`/api/v1/users/${res.userId}`, {
        method: "PATCH", accessType: "server",
        body: { risk_scores: { sign_up: { bot: 150, free_trial_abuse: 0 } } },
      });
      expect(response.status).toBe(400);
    });

    it("rejects risk scores < 0", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const res = await Auth.Password.signUpWithEmail();
      const response = await niceBackendFetch(`/api/v1/users/${res.userId}`, {
        method: "PATCH", accessType: "server",
        body: { risk_scores: { sign_up: { bot: -10, free_trial_abuse: 0 } } },
      });
      expect(response.status).toBe(400);
    });

    it("rejects non-integer risk scores", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const res = await Auth.Password.signUpWithEmail();
      const response = await niceBackendFetch(`/api/v1/users/${res.userId}`, {
        method: "PATCH", accessType: "server",
        body: { risk_scores: { sign_up: { bot: 50.5, free_trial_abuse: 0 } } },
      });
      expect(response.status).toBe(400);
    });

    it("server can update country_code", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });
      const res = await Auth.Password.signUpWithEmail();
      const response = await niceBackendFetch(`/api/v1/users/${res.userId}`, {
        method: "PATCH", accessType: "server", body: { country_code: "FR" },
      });
      expect(response.status).toBe(200);
      expect(response.body.country_code).toBe("FR");
    });

    it("updating other fields does not change risk_scores", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });

      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: `user@${EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN}`,
          password: generateSecureRandomString(),
          turnstile_token: mockTurnstileTokens.invalid,
        },
      });
      expect(response.status).toBe(200);

      const updateResponse = await niceBackendFetch(`/api/v1/users/${response.body.user_id}`, {
        method: "PATCH", accessType: "server", body: { display_name: "Updated Name" },
      });
      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.display_name).toBe("Updated Name");
      assertScores(expect, "unchanged after display_name update", updateResponse.body.risk_scores.sign_up, { bot: 65, free_trial_abuse: 55 });
    });

    it("server-created users default to {0, 0}", async ({ expect }) => {
      const createResponse = await niceBackendFetch("/api/v1/users", {
        method: "POST", accessType: "server",
        body: { primary_email: `server-${generateSecureRandomString(8)}@example.com` },
      });
      expect(createResponse.status).toBe(201);
      assertScores(expect, "server-created default", createResponse.body.risk_scores.sign_up, { bot: 0, free_trial_abuse: 0 });
    });

    it("server can create users with custom risk_scores and country_code", async ({ expect }) => {
      const createResponse = await niceBackendFetch("/api/v1/users", {
        method: "POST",
        accessType: "server",
        body: {
          primary_email: `risky-${generateSecureRandomString(8)}@example.com`,
          country_code: "FR",
          risk_scores: { sign_up: { bot: 55, free_trial_abuse: 42 } },
        },
      });
      expect(createResponse.status).toBe(201);
      expect(createResponse.body.country_code).toBe("FR");
      expect(createResponse.body.risk_scores).toEqual({ sign_up: { bot: 55, free_trial_abuse: 42 } });
    });
  });


  // ──────────────────────────────────────────────────────────────────────────
  // 8. SIGN-UP RULES INTERACTION
  // ──────────────────────────────────────────────────────────────────────────

  describe("sign-up rules interaction", () => {
    it("restricts user when risk score matches CEL condition", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });

      await Project.updateConfig({
        'auth.signUpRules.restrict-high-bot': {
          enabled: true,
          displayName: 'Restrict high bot score',
          priority: 0,
          condition: 'riskScores.bot >= 65',
          action: { type: 'restrict' },
        },
        'auth.signUpRulesDefaultAction': 'allow',
      });

      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: { email: `user@${EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN}`, password: generateSecureRandomString() },
      });
      expect(response.status).toBe(200);

      const userResponse = await niceBackendFetch(`/api/v1/users/${response.body.user_id}`, { method: "GET", accessType: "server" });
      expect(userResponse.body.restricted_by_admin).toBe(true);
      expect(userResponse.body.risk_scores.sign_up.bot).toBe(65);
    });

    it("rejects user when risk score matches CEL reject condition", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });

      await Project.updateConfig({
        'auth.signUpRules.reject-high-risk': {
          enabled: true,
          displayName: 'Reject high risk',
          priority: 0,
          condition: 'riskScores.bot >= 65 && riskScores.free_trial_abuse >= 50',
          action: { type: 'reject' },
        },
        'auth.signUpRulesDefaultAction': 'allow',
      });

      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: { email: `user@${EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN}`, password: generateSecureRandomString() },
      });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("SIGN_UP_REJECTED");
    });

    it("allows user when score is below threshold", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });

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

    it("rejects turnstile-invalid signup when rules block bot >= 20", async ({ expect }) => {
      await Project.createAndSwitch({ config: { credential_enabled: true } });

      await Project.updateConfig({
        'auth.signUpRules.reject-high-bot': {
          enabled: true,
          displayName: 'Reject high bot score',
          priority: 0,
          condition: 'riskScores.bot >= 20',
          action: { type: 'reject' },
        },
        'auth.signUpRulesDefaultAction': 'allow',
      });

      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: `ts-rule-${generateSecureRandomString(8)}@example.com`,
          password: generateSecureRandomString(),
          turnstile_token: mockTurnstileTokens.invalid,
        },
      });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("SIGN_UP_REJECTED");
    });
  });
});
