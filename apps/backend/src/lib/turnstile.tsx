import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { TurnstileAction, TurnstileResult } from "@stackframe/stack-shared/dist/utils/turnstile";

export type SignUpTurnstileAssessment = {
  status: TurnstileResult,
  visibleChallengeResult?: TurnstileResult,
};

const developmentVisibleTurnstileSiteKey = "1x00000000000000000000AA";
const developmentTurnstileSecretKey = "1x0000000000000000000000000000000AA";

type TurnstileSiteverifyResponse = {
  success: boolean,
  action?: string,
};

function normalizeLegacyTurnstileToken(token: string | undefined): string {
  // Backward compatibility: older clients can omit Turnstile entirely.
  // Normalize that to an empty token so verification consistently maps it to "invalid".
  return token?.trim() ?? "";
}

function getTurnstileConfig(options?: {
  siteKey?: string,
  secretKey?: string,
}) {
  const isDevelopmentLike = ["development", "test"].includes(getNodeEnvironment());
  return {
    siteKey: options?.siteKey ?? getEnvVariable("NEXT_PUBLIC_STACK_TURNSTILE_SITE_KEY", isDevelopmentLike ? developmentVisibleTurnstileSiteKey : ""),
    secretKey: options?.secretKey ?? getEnvVariable("STACK_TURNSTILE_SECRET_KEY", isDevelopmentLike ? developmentTurnstileSecretKey : ""),
  };
}

function getTurnstileSiteverifyUrl() {
  // Local development and E2E can point this at a stub verifier, but production should keep the Cloudflare default.
  return getEnvVariable("STACK_TURNSTILE_SITEVERIFY_URL", "https://challenges.cloudflare.com/turnstile/v0/siteverify");
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
  const response = await fetchImpl(getTurnstileSiteverifyUrl(), {
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
  token: string | undefined,
  remoteIp: string | null,
  expectedAction: TurnstileAction,
  siteKey?: string,
  secretKey?: string,
  fetchImpl?: typeof fetch,
}): Promise<SignUpTurnstileAssessment> {
  const token = normalizeLegacyTurnstileToken(params.token);
  if (!token) {
    return { status: "invalid" };
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
  import.meta.vitest?.test("returns invalid when empty token is provided", async ({ expect }) => {
    await expect(verifyTurnstileToken({
      token: "",
      remoteIp: null,
      expectedAction: "sign_up_with_credential",
      siteKey: "site-key",
      secretKey: "secret-key",
    })).resolves.toEqual({ status: "invalid" });
  });

  import.meta.vitest?.test("treats an omitted legacy token as invalid", async ({ expect }) => {
    await expect(verifyTurnstileToken({
      token: undefined,
      remoteIp: null,
      expectedAction: "sign_up_with_credential",
      siteKey: "site-key",
      secretKey: "secret-key",
    })).resolves.toEqual({ status: "invalid" });
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

  import.meta.vitest?.test("falls back to the development Turnstile secret when none is configured", async ({ expect }) => {
    const processEnv = Reflect.get(process, "env");

    const originalNodeEnv = Reflect.get(processEnv, "NODE_ENV");
    const originalSecretKey = Reflect.get(processEnv, "STACK_TURNSTILE_SECRET_KEY");
    const originalSiteKey = Reflect.get(processEnv, "NEXT_PUBLIC_STACK_TURNSTILE_SITE_KEY");
    Reflect.set(processEnv, "NODE_ENV", "development");
    Reflect.set(processEnv, "STACK_TURNSTILE_SECRET_KEY", "");
    Reflect.set(processEnv, "NEXT_PUBLIC_STACK_TURNSTILE_SITE_KEY", "");

    let postedSecret = "";
    try {
      await expect(verifyTurnstileToken({
        token: "real-token",
        remoteIp: "127.0.0.1",
        expectedAction: "sign_up_with_credential",
        fetchImpl: async (_input, init) => {
          const body = init?.body;
          if (!(body instanceof URLSearchParams)) {
            throw new Error("Expected URLSearchParams body");
          }
          postedSecret = body.get("secret") ?? "";
          return new Response(JSON.stringify({
            success: true,
            action: "sign_up_with_credential",
          }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          });
        },
      })).resolves.toEqual({ status: "ok" });
    } finally {
      Reflect.set(processEnv, "NODE_ENV", originalNodeEnv);
      Reflect.set(processEnv, "STACK_TURNSTILE_SECRET_KEY", originalSecretKey);
      Reflect.set(processEnv, "NEXT_PUBLIC_STACK_TURNSTILE_SITE_KEY", originalSiteKey);
    }

    expect(postedSecret).toBe(developmentTurnstileSecretKey);
  });
});
