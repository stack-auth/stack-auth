import createEmailableClient from "emailable";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { traceSpan } from "@stackframe/stack-shared/dist/utils/telemetry";

export const EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN = "emailable-not-deliverable.example.com";

const VERIFY_STATES = ["deliverable", "undeliverable", "risky", "unknown"] as const;

function validateVerifyResponse(value: unknown) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new StackAssertionError("Emailable returned a non-object response body", { value });
  }
  const response = Object.fromEntries(Object.entries(value));
  const { state, disposable } = response;
  if (typeof state !== "string" || !VERIFY_STATES.some(s => s === state)) {
    throw new StackAssertionError("Emailable verify response has invalid or missing state", { response });
  }
  return { ...response, state, disposable: disposable === true };
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
) {
  const apiKey = options?.apiKey ?? getEnvVariable("STACK_EMAILABLE_API_KEY", "");
  const onError = options?.onError ?? "return-error";
  const retryDelayBase = options?.retryExponentialDelayBaseMs ?? 4000;

  if (!apiKey) {
    const emailDomain = email.split("@")[1]?.toLowerCase();
    if (emailDomain === EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN) {
      return {
        status: "not-deliverable" as const,
        emailableResponse: createTestModeUndeliverableResponse(email),
      };
    }
    return { status: "ok" as const };
  }

  return await traceSpan("checking email address with Emailable", async () => {
    try {
      const client = createEmailableClient(apiKey);
      const raw = await verifyWithRetries(() => client.verify(email), 4, retryDelayBase);
      const response = validateVerifyResponse(raw);

      if (response.state === "undeliverable" || response.disposable) {
        return { status: "not-deliverable" as const, emailableResponse: response };
      }

      return { status: "ok" as const };
    } catch (error) {
      captureError("emailable-api-error", error);
      if (onError === "return-ok") {
        return { status: "ok" as const };
      }
      return { status: "error" as const, error };
    }
  });
}

export type EmailableCheckResult = Awaited<ReturnType<typeof checkEmailWithEmailable>>;

import.meta.vitest?.describe("checkEmailWithEmailable(...)", () => {
  import.meta.vitest?.test("returns test-domain rejection when no API key is set", async ({ expect }) => {
    await expect(checkEmailWithEmailable(`user@${EMAILABLE_NOT_DELIVERABLE_TEST_DOMAIN}`, {
      apiKey: "",
    })).resolves.toMatchObject({
      status: "not-deliverable",
      emailableResponse: {
        state: "undeliverable",
        reason: "test_domain_rejection",
      },
    });
  });

  import.meta.vitest?.test("calls emailable test API and returns a valid result", async ({ expect }) => {
    const testApiKey = getEnvVariable("STACK_EMAILABLE_TEST_API_KEY", "");
    if (!testApiKey) {
      return;
    }
    const result = await checkEmailWithEmailable("test@gmail.com", {
      apiKey: testApiKey,
    });
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
