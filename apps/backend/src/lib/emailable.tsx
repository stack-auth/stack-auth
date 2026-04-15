import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { traceSpan } from "@stackframe/stack-shared/dist/utils/telemetry";
import createEmailableClient from "emailable";

export const EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN = "emailable-not-deliverable.example.com";


// ── Types ──────────────────────────────────────────────────────────────

const VERIFY_STATES = ["deliverable", "undeliverable", "risky", "unknown"] as const;
type EmailableVerifyResponse = ReturnType<typeof validateVerifyResponse>;

export type EmailableCheckResult =
  | { status: "deliverable", emailableScore: number | null }
  | { status: "not-deliverable", emailableResponse: EmailableVerifyResponse, emailableScore: number | null }


// ── Helpers ────────────────────────────────────────────────────────────

const RETRY_BACKOFF_BASE_MS = 4000;

function isReservedTestDomain(emailDomain: string): boolean {
  if (!["development", "test"].includes(getNodeEnvironment())) return false;
  return emailDomain === "example.com" || emailDomain.endsWith(".example.com");
}

function validateVerifyResponse(value: unknown) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new StackAssertionError("Emailable returned a non-object response body", { value });
  }
  const response = Object.assign(Object.create(null), value) as Record<string, unknown>;
  const { state, disposable, score } = response;
  if (typeof state !== "string" || !VERIFY_STATES.some(s => s === state)) {
    throw new StackAssertionError("Emailable verify response has invalid or missing state", { response });
  }
  const parsedScore = typeof score === "number" && score >= 0 && score <= 100 ? score : null;
  return { ...response, state, disposable: disposable === true, score: parsedScore };
}

async function verifyWithRetries(verifyFn: () => Promise<unknown>, maxAttempts: number, delayBaseMs: number) {
  for (let i = 0; i < maxAttempts; i++) {
    const res: any = await verifyFn();
    if (!("state" in res)) {
      if ("message" in res && (res.message.includes("Your request is taking longer than normal") || res.message.includes("Your email is still being verified"))) {
        await wait((Math.random() + 0.5) * delayBaseMs * (2 ** i));
        continue;
      }
      throw new StackAssertionError("Emailable returned an unexpected response body", { response: res });
    }
    return res;
  }
  throw new StackAssertionError("Timed out while verifying email address with Emailable");
}

function buildTestUndeliverableResponse(email: string) {
  const match = email.match(/^([^@]+)@([^@]+)$/);
  if (!match) {
    throw new StackAssertionError("Expected a valid email before creating the Emailable test-mode response", { email });
  }
  return {
    accept_all: false, did_you_mean: null, disposable: false, domain: match[2],
    duration: 0, email, first_name: null, free: false, full_name: null, gender: null,
    last_name: null, mailbox_full: false, mx_record: null, no_reply: false,
    reason: "test_domain_rejection", role: false, score: 0, smtp_provider: null,
    state: "undeliverable" as const, tag: null, user: match[1],
  };
}


// ── Public API ─────────────────────────────────────────────────────────

export async function checkEmailWithEmailable(
  email: string,
  options?: {
    retryExponentialDelayBaseMs?: number,
    /** @internal — used by tests to inject a fake client */
    _clientFactory?: (apiKey: string) => { verify: (email: string) => Promise<unknown> },
  },
): Promise<EmailableCheckResult> {
  try {
    const rawApiKey = getEnvVariable("STACK_EMAILABLE_API_KEY", "");
    const emailDomain = email.split("@")[1]?.toLowerCase() ?? "";

    // Always reject the explicit test domain, regardless of API key
    if (emailDomain === EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN) {
      const testResponse = buildTestUndeliverableResponse(email);
      return { status: "not-deliverable", emailableResponse: testResponse, emailableScore: testResponse.score };
    }

    if (!rawApiKey) {
      if (["development", "test"].includes(getNodeEnvironment())) {
        return { status: "deliverable", emailableScore: null };
      }
      throw new StackAssertionError("STACK_EMAILABLE_API_KEY must not be empty; set it to 'disable_email_validation' to disable email validation");
    }

    const apiKey = rawApiKey === "disable_email_validation" ? "" : rawApiKey;
    if (!apiKey || isReservedTestDomain(emailDomain)) {
      return { status: "deliverable", emailableScore: null };
    }

    const clientFactory = options?._clientFactory ?? createEmailableClient;
    const retryDelayBase = options?.retryExponentialDelayBaseMs ?? RETRY_BACKOFF_BASE_MS;

    return await traceSpan("checking email address with Emailable", async () => {
      const client = clientFactory(apiKey);
      const raw = await verifyWithRetries(() => client.verify(email), 4, retryDelayBase);
      console.log("Received emailable response", { email, raw });
      const response = validateVerifyResponse(raw);

      if (response.state === "undeliverable") {
        return { status: "not-deliverable", emailableResponse: response, emailableScore: response.score };
      }
      return { status: "deliverable", emailableScore: response.score };
    });
  } catch (error) {
    captureError("emailable-api-error", new StackAssertionError("Error while checking email address with Emailable", { cause: error, email, options }));
    // If there's an error, let's pretend the email is deliverable, albeit with the score unavailable
    return { status: "deliverable", emailableScore: null };
  }
}


// ── Tests ──────────────────────────────────────────────────────────────

import.meta.vitest?.describe("checkEmailWithEmailable(...)", () => {
  const { vi, test, beforeEach } = import.meta.vitest!;

  const fakeClient = (verifyFn: (email: string) => Promise<unknown>) => (_apiKey: string) => ({ verify: verifyFn });

  const deliverableClient = fakeClient(async () => ({
    state: "deliverable", disposable: false, score: 95, domain: "gmail.com", email: "test@gmail.com", user: "test",
  }));

  const errorClient = fakeClient(async () => {
    throw new Error("network error");
  });

  beforeEach(() => {
    vi.stubEnv("STACK_EMAILABLE_API_KEY", "test_api_key");
    return () => vi.unstubAllEnvs();
  });

  test("returns test-domain rejection regardless of API key", async ({ expect }) => {
    await expect(checkEmailWithEmailable(`user@${EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN}`))
      .resolves.toMatchObject({ status: "not-deliverable", emailableResponse: { state: "undeliverable", reason: "test_domain_rejection" } });
  });

  test("returns test-domain rejection even when API key is unset", async ({ expect }) => {
    vi.stubEnv("STACK_EMAILABLE_API_KEY", "");
    await expect(checkEmailWithEmailable(`user@${EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN}`))
      .resolves.toMatchObject({ status: "not-deliverable", emailableResponse: { state: "undeliverable", reason: "test_domain_rejection" } });
  });

  test("returns ok for deliverable email", async ({ expect }) => {
    const result = await checkEmailWithEmailable("test@gmail.com", { _clientFactory: deliverableClient });
    expect(result).toMatchObject({ status: "deliverable", emailableScore: 95 });
  });

  test("successfully retries and verifies deliverable email if Emailable asks for a retry the first time", async ({ expect }) => {
    let retryCount = 0;
    const retryClient = fakeClient(async () => retryCount++ === 0 ? {
      message: "Your request is taking longer than normal. Please send your request again."
    } : {
      state: "deliverable", disposable: false, score: 95, domain: "gmail.com", email: "test@gmail.com", user: "test",
    });
    const result = await checkEmailWithEmailable("test@gmail.com", { _clientFactory: retryClient });
    expect(retryCount).toBe(2);
    expect(result).toMatchObject({ status: "deliverable", emailableScore: 95 });
  });

  test("returns deliverable on API error", async ({ expect }) => {
    const result = await checkEmailWithEmailable("test@gmail.com", { _clientFactory: errorClient });
    expect(result).toMatchObject({ status: "deliverable", emailableScore: null });
  });

  test("returns deliverable on malformed Emailable response bodies", async ({ expect }) => {
    const malformedClient = fakeClient(async () => "definitely not an object");
    const result = await checkEmailWithEmailable("test@gmail.com", { _clientFactory: malformedClient });
    expect(result).toMatchObject({ status: "deliverable", emailableScore: null });
  });
});
