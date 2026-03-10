import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { getTurnstileTestResult, TurnstileAction, TurnstileResult } from "@stackframe/stack-shared/dist/utils/turnstile";

export type SignUpTurnstileAssessment = {
  status: TurnstileResult,
};

type TurnstileSiteverifyResponse = {
  success: boolean,
  action?: string,
};

function getTurnstileConfig(options?: {
  siteKey?: string,
  secretKey?: string,
}) {
  return {
    siteKey: options?.siteKey ?? getEnvVariable("NEXT_PUBLIC_STACK_TURNSTILE_SITE_KEY", ""),
    secretKey: options?.secretKey ?? getEnvVariable("STACK_TURNSTILE_SECRET_KEY", ""),
  };
}

function isTurnstileConfigured(options?: {
  siteKey?: string,
  secretKey?: string,
}) {
  const { siteKey, secretKey } = getTurnstileConfig(options);
  return siteKey !== "" && secretKey !== "";
}

function isTurnstileSiteverifyResponse(value: unknown): value is TurnstileSiteverifyResponse {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return "success" in value && typeof value.success === "boolean";
}

async function fetchTurnstileVerification(params: {
  token: string,
  remoteIp: string | null,
  secretKey: string,
  fetchImpl?: typeof fetch,
}): Promise<TurnstileSiteverifyResponse> {
  const body = new URLSearchParams({
    secret: params.secretKey,
    response: params.token,
  });
  if (params.remoteIp != null) {
    body.set("remoteip", params.remoteIp);
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new StackAssertionError("Turnstile Siteverify request failed", {
      status: response.status,
      statusText: response.statusText,
    });
  }

  const json = await response.json();
  if (!isTurnstileSiteverifyResponse(json)) {
    throw new StackAssertionError("Turnstile Siteverify response is missing required fields", { json });
  }

  return json;
}

export async function verifyTurnstileToken(params: {
  token: string | null | undefined,
  remoteIp: string | null,
  expectedAction: TurnstileAction,
  siteKey?: string,
  secretKey?: string,
  fetchImpl?: typeof fetch,
}): Promise<SignUpTurnstileAssessment> {
  const testResult = getTurnstileTestResult(params.token);
  if (testResult != null && ["development", "test"].includes(getNodeEnvironment())) {
    return { status: testResult };
  }

  if (!isTurnstileConfigured(params)) {
    return { status: "not_configured" };
  }

  const token = params.token?.trim();
  if (!token) {
    return { status: "missing" };
  }

  const { secretKey } = getTurnstileConfig(params);
  const verificationResult = await Result.fromThrowingAsync(async () => await fetchTurnstileVerification({
    token,
    remoteIp: params.remoteIp,
    secretKey,
    fetchImpl: params.fetchImpl,
  }));

  if (verificationResult.status === "error") {
    captureError("turnstile-siteverify-error", verificationResult.error);
    return { status: "error" };
  }

  if (!verificationResult.data.success) {
    return { status: "invalid" };
  }

  if (verificationResult.data.action != null && verificationResult.data.action !== params.expectedAction) {
    return { status: "invalid" };
  }

  return { status: "ok" };
}

import.meta.vitest?.describe("verifyTurnstileToken(...)", () => {
  import.meta.vitest?.test("returns not_configured when env vars are missing", async ({ expect }) => {
    await expect(verifyTurnstileToken({
      token: null,
      remoteIp: null,
      expectedAction: "sign_up_with_credential",
      siteKey: "",
      secretKey: "",
    })).resolves.toEqual({ status: "not_configured" });
  });

  import.meta.vitest?.test("returns missing when configured but no token was provided", async ({ expect }) => {
    await expect(verifyTurnstileToken({
      token: null,
      remoteIp: null,
      expectedAction: "sign_up_with_credential",
      siteKey: "site-key",
      secretKey: "secret-key",
    })).resolves.toEqual({ status: "missing" });
  });

  import.meta.vitest?.test("maps siteverify success, invalid, and action mismatch responses", async ({ expect }) => {
    const cases = [
      {
        response: { success: true, action: "sign_up_with_credential" },
        expectedStatus: "ok",
      },
      {
        response: { success: false, action: "sign_up_with_credential" },
        expectedStatus: "invalid",
      },
      {
        response: { success: true, action: "oauth_authenticate" },
        expectedStatus: "invalid",
      },
    ] as const;

    for (const testCase of cases) {
      await expect(verifyTurnstileToken({
        token: "real-token",
        remoteIp: "127.0.0.1",
        expectedAction: "sign_up_with_credential",
        siteKey: "site-key",
        secretKey: "secret-key",
        fetchImpl: async () => new Response(JSON.stringify(testCase.response), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      })).resolves.toEqual({ status: testCase.expectedStatus });
    }
  });

  import.meta.vitest?.test("returns error when siteverify fails", async ({ expect }) => {
    await expect(verifyTurnstileToken({
      token: "real-token",
      remoteIp: "127.0.0.1",
      expectedAction: "sign_up_with_credential",
      siteKey: "site-key",
      secretKey: "secret-key",
      fetchImpl: async () => {
        throw new Error("network down");
      },
    })).resolves.toEqual({ status: "error" });
  });
});
