import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../../backend-helpers";

describe("signup rules", () => {
  // ==========================================
  // BASIC RULE BEHAVIOR
  // ==========================================

  it("should allow signup when no rules are configured", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    const res = await Auth.Password.signUpWithEmail();
    expect(res.signUpResponse.status).toBe(200);
  });

  it("should allow signup when rules exist but none match", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.block-specific': {
        enabled: true,
        displayName: 'Block specific email',
        priority: 0,
        condition: 'email == "blocked@example.com"',
        action: {
          type: 'reject',
          message: 'This email is blocked',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Sign up with a different email should work
    const res = await Auth.Password.signUpWithEmail();
    expect(res.signUpResponse.status).toBe(200);
  });

  it("should reject signup when a reject rule matches", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.block-rule': {
        enabled: true,
        displayName: 'Block test emails',
        priority: 0,
        condition: 'email.contains("blocked")',
        action: {
          type: 'reject',
          message: 'Sign-ups from this email are not allowed',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    const blockedEmail = `blocked-${generateSecureRandomString(8)}@example.com`;
    const password = generateSecureRandomString();

    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: blockedEmail,
        password,
      },
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: 'SIGN_UP_REJECTED',
    });
  });

  it("should use custom rejection message from rule", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    const customMessage = "Custom rejection: This domain is not allowed";

    await Project.updateConfig({
      'auth.signupRules.custom-message-rule': {
        enabled: true,
        displayName: 'Block with custom message',
        priority: 0,
        condition: 'emailDomain == "blocked-domain.com"',
        action: {
          type: 'reject',
          message: customMessage,
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-${generateSecureRandomString(8)}@blocked-domain.com`,
        password: generateSecureRandomString(),
      },
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: 'SIGN_UP_REJECTED',
      error: customMessage,
    });
  });

  // ==========================================
  // DEFAULT ACTION BEHAVIOR
  // ==========================================

  it("should apply default 'allow' action when no rules match", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRulesDefaultAction': 'allow',
    });

    const res = await Auth.Password.signUpWithEmail();
    expect(res.signUpResponse.status).toBe(200);
  });

  it("should apply default 'reject' action when no rules match", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRulesDefaultAction': 'reject',
    });

    const email = `test-${generateSecureRandomString(8)}@example.com`;
    const password = generateSecureRandomString();

    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email,
        password,
      },
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: 'SIGN_UP_REJECTED',
    });
  });

  it("should allow specific emails when default is reject", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.allow-company': {
        enabled: true,
        displayName: 'Allow company emails',
        priority: 0,
        condition: 'emailDomain == "allowed-company.com"',
        action: {
          type: 'allow',
        },
      },
      'auth.signupRulesDefaultAction': 'reject',
    });

    // Allowed domain should work
    const allowedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-${generateSecureRandomString(8)}@allowed-company.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(allowedResponse.status).toBe(200);

    // Other domains should be rejected
    const rejectedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-${generateSecureRandomString(8)}@other-domain.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(rejectedResponse.status).toBe(403);
  });

  // ==========================================
  // RULE PRIORITY AND ORDERING
  // ==========================================

  it("should evaluate rules by priority order (lower number = higher priority)", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    // Priority 0 rejects, priority 1 allows - reject should win
    await Project.updateConfig({
      'auth.signupRules.allow-rule': {
        enabled: true,
        displayName: 'Allow all',
        priority: 1,
        condition: 'true',
        action: {
          type: 'allow',
        },
      },
      'auth.signupRules.reject-rule': {
        enabled: true,
        displayName: 'Reject all',
        priority: 0,
        condition: 'true',
        action: {
          type: 'reject',
          message: 'All signups rejected',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `test-${generateSecureRandomString(8)}@example.com`,
        password: generateSecureRandomString(),
      },
    });

    expect(response.status).toBe(403);
  });

  it("should sort rules with same priority alphabetically by ID", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    // Both have priority 0, "aaa-rule" should be evaluated before "zzz-rule"
    await Project.updateConfig({
      'auth.signupRules.zzz-rule': {
        enabled: true,
        displayName: 'Allow (evaluated second)',
        priority: 0,
        condition: 'true',
        action: {
          type: 'allow',
        },
      },
      'auth.signupRules.aaa-rule': {
        enabled: true,
        displayName: 'Reject (evaluated first)',
        priority: 0,
        condition: 'true',
        action: {
          type: 'reject',
          message: 'First rule matched',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `test-${generateSecureRandomString(8)}@example.com`,
        password: generateSecureRandomString(),
      },
    });

    // aaa-rule (reject) should be evaluated first
    expect(response.status).toBe(403);
  });

  it("should stop evaluating after first matching rule", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.first-allow': {
        enabled: true,
        displayName: 'Allow specific domain',
        priority: 0,
        condition: 'emailDomain == "special.com"',
        action: {
          type: 'allow',
        },
      },
      'auth.signupRules.second-reject': {
        enabled: true,
        displayName: 'Reject all',
        priority: 1,
        condition: 'true',
        action: {
          type: 'reject',
          message: 'Should not reach here for special.com',
        },
      },
      'auth.signupRulesDefaultAction': 'reject',
    });

    // special.com should be allowed by first rule
    const allowedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-${generateSecureRandomString(8)}@special.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(allowedResponse.status).toBe(200);

    // Other domains hit second rule and get rejected
    const rejectedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-${generateSecureRandomString(8)}@other.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(rejectedResponse.status).toBe(403);
  });

  // ==========================================
  // DISABLED RULES
  // ==========================================

  it("should skip disabled rules", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.disabled-reject-rule': {
        enabled: false,
        displayName: 'Reject all (disabled)',
        priority: 0,
        condition: 'true',
        action: {
          type: 'reject',
          message: 'Should not see this',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    const res = await Auth.Password.signUpWithEmail();
    expect(res.signUpResponse.status).toBe(200);
  });

  it("should evaluate enabled rules even when disabled rules exist", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.disabled-allow': {
        enabled: false,
        displayName: 'Allow all (disabled)',
        priority: 0,
        condition: 'true',
        action: {
          type: 'allow',
        },
      },
      'auth.signupRules.enabled-reject': {
        enabled: true,
        displayName: 'Reject all (enabled)',
        priority: 1,
        condition: 'true',
        action: {
          type: 'reject',
          message: 'Enabled rule matched',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `test-${generateSecureRandomString(8)}@example.com`,
        password: generateSecureRandomString(),
      },
    });

    expect(response.status).toBe(403);
  });

  // ==========================================
  // STRING METHOD CONDITIONS
  // ==========================================

  it("should match email.contains() condition", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.block-spam': {
        enabled: true,
        displayName: 'Block spam emails',
        priority: 0,
        condition: 'email.contains("spam")',
        action: {
          type: 'reject',
          message: 'Spam detected',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Email containing "spam" should be rejected
    const spamResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `spammer-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(spamResponse.status).toBe(403);

    // Normal email should be allowed
    const normalResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `normal-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(normalResponse.status).toBe(200);
  });

  it("should match email.startsWith() condition", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.block-test-prefix': {
        enabled: true,
        displayName: 'Block test prefix',
        priority: 0,
        condition: 'email.startsWith("test-blocked")',
        action: {
          type: 'reject',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Email starting with "test-blocked" should be rejected
    const blockedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `test-blocked-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(blockedResponse.status).toBe(403);

    // Other emails should be allowed
    const allowedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `allowed-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(allowedResponse.status).toBe(200);
  });

  it("should match email.endsWith() condition", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.block-suffix': {
        enabled: true,
        displayName: 'Block disposable suffix',
        priority: 0,
        condition: 'email.endsWith("@tempmail.com")',
        action: {
          type: 'reject',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Email ending with @tempmail.com should be rejected
    const blockedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-${generateSecureRandomString(4)}@tempmail.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(blockedResponse.status).toBe(403);

    // Other emails should be allowed
    const allowedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-${generateSecureRandomString(4)}@gmail.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(allowedResponse.status).toBe(200);
  });

  it("should match email.matches() regex condition", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.block-numeric': {
        enabled: true,
        displayName: 'Block numeric-only usernames',
        priority: 0,
        // Match emails where local part is only digits
        condition: 'email.matches("^[0-9]+@")',
        action: {
          type: 'reject',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Email with numeric-only local part should be rejected
    const blockedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `12345678@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(blockedResponse.status).toBe(403);

    // Email with letters should be allowed
    const allowedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user123-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(allowedResponse.status).toBe(200);
  });

  // ==========================================
  // EMAIL DOMAIN CONDITIONS
  // ==========================================

  it("should match emailDomain == condition", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.domain-block': {
        enabled: true,
        displayName: 'Block specific domain',
        priority: 0,
        condition: 'emailDomain == "blocked-domain.org"',
        action: {
          type: 'reject',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Blocked domain should be rejected
    const blockedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-${generateSecureRandomString(4)}@blocked-domain.org`,
        password: generateSecureRandomString(),
      },
    });
    expect(blockedResponse.status).toBe(403);

    // Other domains should be allowed
    const allowedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-${generateSecureRandomString(4)}@allowed-domain.org`,
        password: generateSecureRandomString(),
      },
    });
    expect(allowedResponse.status).toBe(200);
  });

  it("should match emailDomain in list condition", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.block-disposable': {
        enabled: true,
        displayName: 'Block disposable emails',
        priority: 0,
        condition: 'emailDomain in ["tempmail.com", "throwaway.io", "fakeinbox.net"]',
        action: {
          type: 'reject',
          message: 'Disposable emails not allowed',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // All listed domains should be rejected
    for (const domain of ["tempmail.com", "throwaway.io", "fakeinbox.net"]) {
      const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
        method: "POST",
        accessType: "client",
        body: {
          email: `user-${generateSecureRandomString(4)}@${domain}`,
          password: generateSecureRandomString(),
        },
      });
      expect(response.status).toBe(403);
    }

    // Other domains should be allowed
    const allowedResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-${generateSecureRandomString(4)}@gmail.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(allowedResponse.status).toBe(200);
  });

  // ==========================================
  // AUTH METHOD CONDITIONS
  // ==========================================

  it("should match authMethod condition for password signup", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
        magic_link_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.password-only': {
        enabled: true,
        displayName: 'Allow only password signups',
        priority: 0,
        condition: 'authMethod != "password"',
        action: {
          type: 'reject',
          message: 'Only password authentication is allowed',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Password signup should work
    const passwordRes = await Auth.Password.signUpWithEmail();
    expect(passwordRes.signUpResponse.status).toBe(200);
  });

  it("should match authMethod in list condition", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    // Allow only password and otp methods
    await Project.updateConfig({
      'auth.signupRules.restrict-methods': {
        enabled: true,
        displayName: 'Restrict to password and OTP',
        priority: 0,
        condition: '!(authMethod in ["password", "otp"])',
        action: {
          type: 'reject',
          message: 'Auth method not allowed',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Password signup should work
    const passwordRes = await Auth.Password.signUpWithEmail();
    expect(passwordRes.signUpResponse.status).toBe(200);
  });

  // ==========================================
  // COMPOUND CONDITIONS (AND/OR)
  // ==========================================

  it("should handle AND conditions", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.complex-rule': {
        enabled: true,
        displayName: 'Block test users from specific domain',
        priority: 0,
        condition: 'email.contains("test") && emailDomain == "example.com"',
        action: {
          type: 'reject',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // test@example.com should be rejected (both conditions match)
    const response1 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `test-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response1.status).toBe(403);

    // test@other.com should be allowed (domain doesn't match)
    const response2 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `test-${generateSecureRandomString(4)}@other.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response2.status).toBe(200);

    // real@example.com should be allowed (no "test" in email)
    const response3 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `real-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response3.status).toBe(200);
  });

  it("should handle OR conditions", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.or-rule': {
        enabled: true,
        displayName: 'Block spam or bot patterns',
        priority: 0,
        condition: 'email.contains("spam") || email.contains("bot")',
        action: {
          type: 'reject',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Email with "spam" should be rejected
    const response1 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `spam-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response1.status).toBe(403);

    // Email with "bot" should be rejected
    const response2 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `bot-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response2.status).toBe(403);

    // Normal email should be allowed
    const response3 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `normal-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response3.status).toBe(200);
  });

  it("should handle nested AND/OR conditions", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    // Block if: (contains "test" OR contains "demo") AND domain is example.com
    await Project.updateConfig({
      'auth.signupRules.nested-rule': {
        enabled: true,
        displayName: 'Nested condition',
        priority: 0,
        condition: '(email.contains("test") || email.contains("demo")) && emailDomain == "example.com"',
        action: {
          type: 'reject',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // test@example.com should be rejected
    const response1 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `test-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response1.status).toBe(403);

    // demo@example.com should be rejected
    const response2 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `demo-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response2.status).toBe(403);

    // test@other.com should be allowed (wrong domain)
    const response3 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `test-${generateSecureRandomString(4)}@other.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response3.status).toBe(200);

    // user@example.com should be allowed (no test/demo)
    const response4 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response4.status).toBe(200);
  });

  it("should handle method calls with similar arguments that would collide after sanitization", async ({ expect }) => {
    // Regression test: Previously, different string arguments like "test+1" and "test-1"
    // would both sanitize to "test_1", causing the second result to overwrite the first.
    // This test ensures each method call gets a unique key.
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    // Rule: block emails containing "bad+char" but allow emails containing "bad-char"
    // If the collision bug exists, both would evaluate to the same result
    await Project.updateConfig({
      'auth.signupRules.collision-test': {
        enabled: true,
        displayName: 'Test collision handling',
        priority: 0,
        condition: 'email.contains("bad+char") && !email.contains("bad-char")',
        action: {
          type: 'reject',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Email with "bad+char" but not "bad-char" should be rejected
    const response1 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-bad+char-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response1.status).toBe(403);

    // Email with "bad-char" but not "bad+char" should be allowed
    // If the bug existed, this would incorrectly be rejected
    const response2 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-bad-char-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response2.status).toBe(200);

    // Email with both patterns should be allowed (the !email.contains("bad-char") fails)
    const response3 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-bad+char-bad-char-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response3.status).toBe(200);

    // Email with neither pattern should be allowed
    const response4 = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `normal-user-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response4.status).toBe(200);
  });

  // ==========================================
  // ACTION TYPES
  // ==========================================

  it("should handle 'allow' action type", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.allow-specific': {
        enabled: true,
        displayName: 'Allow specific pattern',
        priority: 0,
        condition: 'email.contains("vip")',
        action: {
          type: 'allow',
        },
      },
      'auth.signupRulesDefaultAction': 'reject',
    });

    // VIP email should be allowed
    const vipResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `vip-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(vipResponse.status).toBe(200);

    // Non-VIP should be rejected by default
    const normalResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `normal-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(normalResponse.status).toBe(403);
  });

  it("should handle 'log' action type (allows signup but logs)", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.log-suspicious': {
        enabled: true,
        displayName: 'Log suspicious patterns',
        priority: 0,
        condition: 'email.contains("suspicious")',
        action: {
          type: 'log',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Suspicious email should still be allowed (log doesn't block)
    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `suspicious-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(response.status).toBe(200);
  });

  // ==========================================
  // ANONYMOUS USER BEHAVIOR
  // ==========================================

  it("should NOT trigger rules when creating anonymous user", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    // Set default to reject - this would block normal signups
    await Project.updateConfig({
      'auth.signupRulesDefaultAction': 'reject',
    });

    // Anonymous signup should still work (rules don't apply)
    const response = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
      accessType: "client",
      method: "POST",
      body: {},
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("access_token");
  });

  it("should trigger rules when converting anonymous user to regular user", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    // Create rule that blocks certain emails
    await Project.updateConfig({
      'auth.signupRules.block-conversion': {
        enabled: true,
        displayName: 'Block blocked email conversion',
        priority: 0,
        condition: 'email.contains("blocked")',
        action: {
          type: 'reject',
          message: 'Cannot convert with this email',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // First create anonymous user
    const anonResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
      accessType: "client",
      method: "POST",
      body: {},
    });
    expect(anonResponse.status).toBe(200);

    const accessToken = anonResponse.body.access_token;

    // Try to convert with blocked email - should be rejected
    const convertResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      headers: {
        "x-stack-access-token": accessToken,
      },
      body: {
        email: `blocked-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });

    expect(convertResponse.status).toBe(403);
    expect(convertResponse.body).toMatchObject({
      code: 'SIGN_UP_REJECTED',
    });
  });

  it("should allow converting anonymous user when rules pass", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.block-blocked': {
        enabled: true,
        displayName: 'Block blocked emails',
        priority: 0,
        condition: 'email.contains("blocked")',
        action: {
          type: 'reject',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // First create anonymous user
    const anonResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
      accessType: "client",
      method: "POST",
      body: {},
    });
    expect(anonResponse.status).toBe(200);

    const accessToken = anonResponse.body.access_token;

    // Convert with allowed email - should work
    const convertResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      headers: {
        "x-stack-access-token": accessToken,
      },
      body: {
        email: `allowed-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });

    expect(convertResponse.status).toBe(200);
  });

  // ==========================================
  // EDGE CASES
  // ==========================================

  it("should handle rule with always-true condition", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.block-all': {
        enabled: true,
        displayName: 'Block all signups',
        priority: 0,
        condition: 'true',
        action: {
          type: 'reject',
          message: 'All signups are currently disabled',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `any-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });

    expect(response.status).toBe(403);
  });

  it("should handle rule with always-false condition", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.never-match': {
        enabled: true,
        displayName: 'Never matches',
        priority: 0,
        condition: 'false',
        action: {
          type: 'reject',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Should be allowed since rule never matches
    const res = await Auth.Password.signUpWithEmail();
    expect(res.signUpResponse.status).toBe(200);
  });

  it("should handle multiple rules with different conditions", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.block-spam-domain': {
        enabled: true,
        displayName: 'Block spam domains',
        priority: 0,
        condition: 'emailDomain == "spam.com"',
        action: {
          type: 'reject',
          message: 'Spam domain blocked',
        },
      },
      'auth.signupRules.block-bot-pattern': {
        enabled: true,
        displayName: 'Block bot patterns',
        priority: 1,
        condition: 'email.startsWith("bot-")',
        action: {
          type: 'reject',
          message: 'Bot pattern blocked',
        },
      },
      'auth.signupRules.block-numeric': {
        enabled: true,
        displayName: 'Block numeric emails',
        priority: 2,
        condition: 'email.matches("^[0-9]+@")',
        action: {
          type: 'reject',
          message: 'Numeric email blocked',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Test spam domain
    const spamResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user@spam.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(spamResponse.status).toBe(403);

    // Test bot pattern
    const botResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `bot-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(botResponse.status).toBe(403);

    // Test numeric email
    const numericResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `123456789@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(numericResponse.status).toBe(403);

    // Normal email should pass all rules
    const normalResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `normal-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(normalResponse.status).toBe(200);
  });

  it("should handle empty email gracefully", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.require-email': {
        enabled: true,
        displayName: 'Check email exists',
        priority: 0,
        condition: 'email == ""',
        action: {
          type: 'reject',
          message: 'Email is required',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Empty email should be handled (rejected for other reasons by the API)
    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: "",
        password: generateSecureRandomString(),
      },
    });

    // Will likely fail with validation error before rule is checked
    expect(response.status).not.toBe(200);
  });

  it("should handle special characters in email", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.block-plus': {
        enabled: true,
        displayName: 'Block plus addressing',
        priority: 0,
        condition: 'email.contains("+")',
        action: {
          type: 'reject',
          message: 'Plus addressing not allowed',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Email with + should be rejected
    const plusResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user+tag@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(plusResponse.status).toBe(403);

    // Normal email should work
    const normalResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `user-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(normalResponse.status).toBe(200);
  });

  it("should handle case sensitivity correctly", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.block-admin': {
        enabled: true,
        displayName: 'Block admin pattern',
        priority: 0,
        // Note: This is case-sensitive by default
        condition: 'email.contains("admin")',
        action: {
          type: 'reject',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Lowercase "admin" should be blocked
    const lowerResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `admin-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    expect(lowerResponse.status).toBe(403);

    // Uppercase "ADMIN" may or may not be blocked depending on email normalization
    // The rule as written is case-sensitive
    const upperResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `ADMIN-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });
    // Emails are typically normalized to lowercase, so this might also be blocked
    // This test documents the actual behavior
    expect([200, 403]).toContain(upperResponse.status);
  });

  // ==========================================
  // RESTRICT ACTION - Admin Restriction
  // ==========================================

  it("should create restricted user when restrict action matches", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.restrict-test-domain': {
        enabled: true,
        displayName: 'Restrict test domain users',
        priority: 0,
        condition: 'emailDomain == "restricted-test.com"',
        action: {
          type: 'restrict',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    const email = `user-${generateSecureRandomString(8)}@restricted-test.com`;
    const password = generateSecureRandomString();

    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: { email, password },
    });

    // Should succeed but user should be restricted
    expect(response.status).toBe(200);

    // Get the user via admin API to check restricted status
    const userId = response.body.user_id;
    const userResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "GET",
      accessType: "admin",
    });

    expect(userResponse.status).toBe(200);
    expect(userResponse.body.restricted_by_admin).toBe(true);
    // Signup rules set private_details (internal), not reason (public)
    expect(userResponse.body.restricted_by_admin_reason).toBe(null);
    expect(userResponse.body.restricted_by_admin_private_details).toContain("signup rule");
    expect(userResponse.body.is_restricted).toBe(true);
    expect(userResponse.body.restricted_reason).toEqual({ type: "restricted_by_administrator" });
  });

  it("should not restrict user when restrict rule doesn't match", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.restrict-bad-domain': {
        enabled: true,
        displayName: 'Restrict bad domain',
        priority: 0,
        condition: 'emailDomain == "bad-domain.com"',
        action: {
          type: 'restrict',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // Sign up with a different domain
    const email = `user-${generateSecureRandomString(8)}@good-domain.com`;
    const password = generateSecureRandomString();

    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: { email, password },
    });

    expect(response.status).toBe(200);

    // User should NOT be restricted
    const userId = response.body.user_id;
    const userResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "GET",
      accessType: "admin",
    });

    expect(userResponse.status).toBe(200);
    expect(userResponse.body.restricted_by_admin).toBe(false);
    expect(userResponse.body.restricted_by_admin_reason).toBe(null);
    expect(userResponse.body.restricted_by_admin_private_details).toBe(null);
    expect(userResponse.body.is_restricted).toBe(false);
  });

  // ==========================================
  // ADMIN RESTRICTION + EMAIL VERIFICATION INTERACTION
  // ==========================================

  it("should show email_not_verified reason when both apply (user can fix email verification)", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    // Enable email verification requirement
    await Project.updateConfig({
      'onboarding.requireEmailVerification': true,
      'auth.signupRules.restrict-suspicious': {
        enabled: true,
        displayName: 'Restrict suspicious domain',
        priority: 0,
        condition: 'emailDomain == "suspicious-test.com"',
        action: {
          type: 'restrict',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    const email = `user-${generateSecureRandomString(8)}@suspicious-test.com`;
    const password = generateSecureRandomString();

    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: { email, password },
    });

    expect(response.status).toBe(200);

    const userId = response.body.user_id;
    const userResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "GET",
      accessType: "admin",
    });

    expect(userResponse.status).toBe(200);
    // Both restrictions apply, but email_not_verified takes precedence because user can fix it
    expect(userResponse.body.restricted_by_admin).toBe(true);
    expect(userResponse.body.is_restricted).toBe(true);
    // email_not_verified should take precedence as it's user-actionable
    expect(userResponse.body.restricted_reason).toEqual({ type: "email_not_verified" });
  });

  it("should show restricted_by_administrator after email is verified if admin restriction still applies", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    // Enable email verification requirement and add restrict rule
    await Project.updateConfig({
      'onboarding.requireEmailVerification': true,
      'auth.signupRules.restrict-flagged': {
        enabled: true,
        displayName: 'Restrict flagged domain',
        priority: 0,
        condition: 'emailDomain == "flagged-domain.com"',
        action: {
          type: 'restrict',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    const email = `user-${generateSecureRandomString(8)}@flagged-domain.com`;
    const password = generateSecureRandomString();

    const signupResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: { email, password },
    });

    expect(signupResponse.status).toBe(200);
    const userId = signupResponse.body.user_id;

    // Verify the email via admin API
    const verifyResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "PATCH",
      accessType: "admin",
      body: {
        primary_email_verified: true,
      },
    });
    expect(verifyResponse.status).toBe(200);

    // Check user's restricted status again
    const userResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "GET",
      accessType: "admin",
    });

    expect(userResponse.status).toBe(200);
    expect(userResponse.body.primary_email_verified).toBe(true);
    expect(userResponse.body.restricted_by_admin).toBe(true);
    expect(userResponse.body.is_restricted).toBe(true);
    // Now that email is verified, restricted_by_administrator should show
    expect(userResponse.body.restricted_reason).toEqual({ type: "restricted_by_administrator" });
  });

  // ==========================================
  // MANUAL ADMIN RESTRICTION VIA API
  // ==========================================

  it("should allow admin to manually restrict a user", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    const { userId } = await Auth.Password.signUpWithEmail();

    // User should not be restricted initially
    const beforeResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "GET",
      accessType: "admin",
    });
    expect(beforeResponse.body.restricted_by_admin).toBe(false);
    expect(beforeResponse.body.is_restricted).toBe(false);

    // Admin restricts the user with public reason and private details
    const restrictResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "PATCH",
      accessType: "admin",
      body: {
        restricted_by_admin: true,
        restricted_by_admin_reason: "Your account is under review",
        restricted_by_admin_private_details: "Suspicious activity detected - flagged by fraud team",
      },
    });
    expect(restrictResponse.status).toBe(200);

    // Check user is now restricted
    const afterResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "GET",
      accessType: "admin",
    });
    expect(afterResponse.body.restricted_by_admin).toBe(true);
    expect(afterResponse.body.restricted_by_admin_reason).toBe("Your account is under review");
    expect(afterResponse.body.restricted_by_admin_private_details).toBe("Suspicious activity detected - flagged by fraud team");
    expect(afterResponse.body.is_restricted).toBe(true);
    expect(afterResponse.body.restricted_reason).toEqual({ type: "restricted_by_administrator" });
  });

  it("should allow setting restricted_by_admin: true without reason or details (both are optional)", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    const { userId } = await Auth.Password.signUpWithEmail();

    // Restrict without reason or details - should succeed (both are optional)
    const restrictResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "PATCH",
      accessType: "admin",
      body: {
        restricted_by_admin: true,
      },
    });
    expect(restrictResponse.status).toBe(200);

    // Verify the user is restricted
    const userResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "GET",
      accessType: "admin",
    });
    expect(userResponse.body.restricted_by_admin).toBe(true);
    expect(userResponse.body.restricted_by_admin_reason).toBe(null);
    expect(userResponse.body.restricted_by_admin_private_details).toBe(null);
    expect(userResponse.body.is_restricted).toBe(true);
  });

  it("should reject setting restricted_by_admin: false with a reason", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    const { userId } = await Auth.Password.signUpWithEmail();

    // Try to set unrestricted with a reason - should fail
    const restrictResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "PATCH",
      accessType: "admin",
      body: {
        restricted_by_admin: false,
        restricted_by_admin_reason: "Some reason",
      },
    });
    expect(restrictResponse.status).toBe(400);
    expect(restrictResponse.body.code).toBe('SCHEMA_ERROR');
  });

  it("should reject setting restricted_by_admin: false with private details", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    const { userId } = await Auth.Password.signUpWithEmail();

    // Try to set unrestricted with private details - should fail
    const restrictResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "PATCH",
      accessType: "admin",
      body: {
        restricted_by_admin: false,
        restricted_by_admin_private_details: "Some details",
      },
    });
    expect(restrictResponse.status).toBe(400);
    expect(restrictResponse.body.code).toBe('SCHEMA_ERROR');
  });

  it("should allow admin to unrestrict a user", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    // Create a user with admin restriction via signup rule
    await Project.updateConfig({
      'auth.signupRules.auto-restrict': {
        enabled: true,
        displayName: 'Auto-restrict all',
        priority: 0,
        condition: 'true',
        action: {
          type: 'restrict',
        },
      },
    });

    const email = `user-${generateSecureRandomString(8)}@example.com`;
    const password = generateSecureRandomString();

    const signupResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: { email, password },
    });
    expect(signupResponse.status).toBe(200);
    const userId = signupResponse.body.user_id;

    // Verify user is restricted
    const beforeResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "GET",
      accessType: "admin",
    });
    expect(beforeResponse.body.restricted_by_admin).toBe(true);
    expect(beforeResponse.body.is_restricted).toBe(true);

    // Admin unrestricts the user
    const unrestrictResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "PATCH",
      accessType: "admin",
      body: {
        restricted_by_admin: false,
        restricted_by_admin_reason: null,
        restricted_by_admin_private_details: null,
      },
    });
    expect(unrestrictResponse.status).toBe(200);

    // Check user is no longer restricted
    const afterResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "GET",
      accessType: "admin",
    });
    expect(afterResponse.body.restricted_by_admin).toBe(false);
    expect(afterResponse.body.restricted_by_admin_reason).toBe(null);
    expect(afterResponse.body.restricted_by_admin_private_details).toBe(null);
    expect(afterResponse.body.is_restricted).toBe(false);
  });

  // ==========================================
  // METADATA WITH TARGET
  // ==========================================

  it("should add metadata to correct target when add_metadata action matches", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.add-metadata-rule': {
        enabled: true,
        displayName: 'Add metadata for test domain',
        priority: 0,
        condition: 'emailDomain == "metadata-test.com"',
        action: {
          type: 'add_metadata',
          metadata: {
            'signup_source': { value: 'test_domain', target: 'server' },
            'user_tier': { value: 'standard', target: 'client_read_only' },
            'preferences': { value: 'default', target: 'client' },
          },
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    const email = `user-${generateSecureRandomString(8)}@metadata-test.com`;
    const password = generateSecureRandomString();

    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: { email, password },
    });

    expect(response.status).toBe(200);
    const userId = response.body.user_id;

    // Get user with admin access to see all metadata
    const userResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "GET",
      accessType: "admin",
    });

    expect(userResponse.status).toBe(200);
    expect(userResponse.body.server_metadata).toMatchObject({
      signup_source: 'test_domain',
    });
    expect(userResponse.body.client_read_only_metadata).toMatchObject({
      user_tier: 'standard',
    });
    expect(userResponse.body.client_metadata).toMatchObject({
      preferences: 'default',
    });
  });

  it("should merge metadata from signup rule with existing metadata", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.add-tag': {
        enabled: true,
        displayName: 'Add signup tag',
        priority: 0,
        condition: 'true',
        action: {
          type: 'add_metadata',
          metadata: {
            'signup_tag': { value: 'via_rule', target: 'server' },
          },
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    // First, sign up a user
    const email = `user-${generateSecureRandomString(8)}@example.com`;
    const password = generateSecureRandomString();

    const signupResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: { email, password },
    });
    expect(signupResponse.status).toBe(200);
    const userId = signupResponse.body.user_id;

    // Then add some additional metadata manually
    const updateResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "PATCH",
      accessType: "admin",
      body: {
        server_metadata: {
          signup_tag: 'via_rule',  // Keep the original
          manual_tag: 'added_later',  // Add new
        },
      },
    });
    expect(updateResponse.status).toBe(200);

    // Verify both metadata exist
    const userResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "GET",
      accessType: "admin",
    });

    expect(userResponse.body.server_metadata).toMatchObject({
      signup_tag: 'via_rule',
      manual_tag: 'added_later',
    });
  });

  // ==========================================
  // ERROR MESSAGE SECURITY
  // ==========================================

  it("should not expose rule details in rejection error message", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        credential_enabled: true,
      },
    });

    await Project.updateConfig({
      'auth.signupRules.secret-rule': {
        enabled: true,
        displayName: 'Block specific secret pattern',
        priority: 0,
        condition: 'email.contains("secret-pattern-xyz")',
        action: {
          type: 'reject',
          message: 'This internal message should NOT be exposed to users',
        },
      },
      'auth.signupRulesDefaultAction': 'allow',
    });

    const response = await niceBackendFetch("/api/v1/auth/password/sign-up", {
      method: "POST",
      accessType: "client",
      body: {
        email: `secret-pattern-xyz-${generateSecureRandomString(4)}@example.com`,
        password: generateSecureRandomString(),
      },
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('SIGN_UP_REJECTED');
    // The error message should NOT contain the custom rule message
    expect(response.body.error).not.toContain('internal message');
    expect(response.body.error).not.toContain('secret-pattern-xyz');
  });
});
