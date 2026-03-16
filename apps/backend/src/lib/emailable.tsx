import createEmailableClient from "emailable";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { traceSpan } from "@stackframe/stack-shared/dist/utils/telemetry";

export const EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN = "emailable-not-deliverable.example.com";

// RFC 2606 reserves example.com and its subdomains for testing — they will never have real
// mailboxes, so sending them through emailable wastes API credits and returns misleading results.
// Only skip in dev/test to prevent attackers from using example.com domains to bypass checks in prod.
function isReservedTestDomain(emailDomain: string): boolean {
  if (!["development", "test"].includes(getNodeEnvironment())) {
    return false;
  }
  return emailDomain === "example.com" || emailDomain.endsWith(".example.com");
}

const EMAILABLE_RETRY_BACKOFF_BASE_MS = 4000;


const VERIFY_STATES = ["deliverable", "undeliverable", "risky", "unknown"] as const;
type EmailableVerifyResponse = ReturnType<typeof validateVerifyResponse>;
export type EmailableCheckResult =
  | { status: "ok", emailableScore: number | null }
  | { status: "not-deliverable", emailableResponse: EmailableVerifyResponse, emailableScore: number | null }
  | { status: "error", error: unknown, emailableScore: null };

function validateVerifyResponse(value: unknown) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new StackAssertionError("Emailable returned a non-object response body", { value });
  }
  const response = Object.fromEntries(Object.entries(value));
  const { state, disposable, score } = response;
  if (typeof state !== "string" || !VERIFY_STATES.some(s => s === state)) {
    throw new StackAssertionError("Emailable verify response has invalid or missing state", { response });
  }
  const parsedScore = typeof score === "number" && score >= 0 && score <= 100 ? score : null;
  return { ...response, state, disposable: disposable === true, score: parsedScore };
}

async function verifyWithRetries(
  verifyFn: () => Promise<unknown>,
  maxAttempts: number,
  delayBaseMs: number,
) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await verifyFn();
    } catch (error) {
      const code = (error != null && typeof error === "object" && !Array.isArray(error))
        ? Reflect.get(error, "code")
        : null;
      if (code !== 249) throw error;
      if (i < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, (Math.random() + 0.5) * delayBaseMs * (2 ** i)));
      }
    }
  }
  throw new StackAssertionError("Timed out while verifying email address with Emailable");
}

function createTestModeUndeliverableResponse(email: string) {
  const match = email.match(/^([^@]+)@([^@]+)$/);
  if (match == null) {
    throw new StackAssertionError("Expected a valid email before creating the Emailable test-mode response", { email });
  }
  const [, userPart, domainPart] = match;
  return {
    accept_all: false,
    did_you_mean: null,
    disposable: false,
    domain: domainPart,
    duration: 0,
    email,
    first_name: null,
    free: false,
    full_name: null,
    gender: null,
    last_name: null,
    mailbox_full: false,
    mx_record: null,
    no_reply: false,
    reason: "test_domain_rejection",
    role: false,
    score: 0,
    smtp_provider: null,
    state: "undeliverable" as const,
    tag: null,
    user: userPart,
  };
}

export async function checkEmailWithEmailable(
  email: string,
  options?: {
    apiKey?: string,
    onError?: "return-error" | "return-ok",
    retryExponentialDelayBaseMs?: number,
  },
): Promise<EmailableCheckResult> {
  const rawApiKey = options?.apiKey ?? getEnvVariable("STACK_EMAILABLE_API_KEY", "");
  if (!rawApiKey) {
    throw new StackAssertionError("STACK_EMAILABLE_API_KEY must not be empty; set it to 'disable_email_validation' to disable email validation");
  }
  const apiKey = rawApiKey === "disable_email_validation" ? "" : rawApiKey;
  const onError = options?.onError ?? "return-error";
  const retryDelayBase = options?.retryExponentialDelayBaseMs ?? EMAILABLE_RETRY_BACKOFF_BASE_MS;

  const emailDomain = email.split("@")[1]?.toLowerCase() ?? "";

  // Always reject the explicit test domain, regardless of API key
  if (emailDomain === EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN) {
    const testResponse = createTestModeUndeliverableResponse(email);
    return {
      status: "not-deliverable" as const,
      emailableResponse: testResponse,
      emailableScore: testResponse.score,
    };
  }

  // Skip API call for RFC 2606 reserved domains (example.com and subdomains) — they have
  // no real mailboxes and emailable returns misleading undeliverable results for them.
  if (!apiKey || isReservedTestDomain(emailDomain)) {
    return { status: "ok", emailableScore: null };
  }

  return await traceSpan("checking email address with Emailable", async () => {
    try {
      const client = createEmailableClient(apiKey);
      const raw = await verifyWithRetries(() => client.verify(email), 4, retryDelayBase);
      const response = validateVerifyResponse(raw);

      if (response.state === "undeliverable" || response.disposable) {
        return { status: "not-deliverable", emailableResponse: response, emailableScore: response.score };
      }

      return { status: "ok", emailableScore: response.score };
    } catch (error) {
      captureError("emailable-api-error", error);
      if (onError === "return-ok") {
        return { status: "ok", emailableScore: null };
      }
      return { status: "error", error, emailableScore: null };
    }
  });
}

import.meta.vitest?.describe("checkEmailWithEmailable(...)", () => {
  import.meta.vitest?.test("returns test-domain rejection when no API key is set", async ({ expect }) => {
    await expect(checkEmailWithEmailable(`user@${EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN}`, {
      apiKey: "disable_email_validation",
    })).resolves.toMatchObject({
      status: "not-deliverable",
      emailableResponse: {
        state: "undeliverable",
        reason: "test_domain_rejection",
      },
    });
  });

  import.meta.vitest?.test("calls emailable API and returns a valid result when STACK_EMAILABLE_API_KEY is set", async ({ expect }) => {
    const envKey = getEnvVariable("STACK_EMAILABLE_API_KEY", "");
    if (!envKey || envKey === "disable_email_validation") {
      return;
    }
    const result = await checkEmailWithEmailable("test@gmail.com");
    expect(["ok", "not-deliverable"]).toContain(result.status);
  });

  import.meta.vitest?.test("returns ok on API error with onError=return-ok", async ({ expect }) => {
    const result = await checkEmailWithEmailable("test@gmail.com", {
      apiKey: "invalid_key_that_will_fail",
      onError: "return-ok",
    });
    expect(result.status).toBe("ok");
  });

  import.meta.vitest?.test("returns error on API error with default onError", async ({ expect }) => {
    const result = await checkEmailWithEmailable("test@gmail.com", {
      apiKey: "invalid_key_that_will_fail",
    });
    expect(result.status).toBe("error");
  });
});
