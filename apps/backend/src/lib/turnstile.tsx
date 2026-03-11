import { KnownErrors } from "@stackframe/stack-shared";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { TurnstileAction, TurnstilePhase, TurnstileResult, TurnstileRetryResult, turnstileDevelopmentKeys, turnstilePhaseValues, turnstileRetryResultValues } from "@stackframe/stack-shared/dist/utils/turnstile";
import { yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { BestEffortEndUserRequestContext, getBestEffortEndUserRequestContext } from "./end-users";

export type SignUpTurnstileAssessment = {
  status: TurnstileResult,
  visibleChallengeResult?: TurnstileResult,
};

export type TurnstileFlowRequest = {
  turnstile_token?: string,
  turnstile_phase?: TurnstilePhase,
  turnstile_previous_result?: TurnstileRetryResult,
};

export const turnstileFlowRequestSchemaFields = {
  turnstile_token: yupString().optional(),
  turnstile_phase: yupString().oneOf(turnstilePhaseValues).optional(),
  turnstile_previous_result: yupString().oneOf(turnstileRetryResultValues).optional(),
} as const;

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
    siteKey: options?.siteKey ?? getEnvVariable("NEXT_PUBLIC_STACK_TURNSTILE_SITE_KEY", isDevelopmentLike ? turnstileDevelopmentKeys.visibleSiteKey : ""),
    secretKey: options?.secretKey ?? getEnvVariable("STACK_TURNSTILE_SECRET_KEY", isDevelopmentLike ? turnstileDevelopmentKeys.secretKey : ""),
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

export async function verifyTurnstileTokenWithOptionalVisibleChallenge(params: {
  token: string | undefined,
  remoteIp: string | null,
  expectedAction: TurnstileAction,
  phase?: "invisible" | "visible",
  previousResult?: TurnstileRetryResult,
  siteKey?: string,
  secretKey?: string,
  fetchImpl?: typeof fetch,
}): Promise<SignUpTurnstileAssessment> {
  const assessment = await verifyTurnstileToken(params);

  if (params.phase == null) {
    if (params.previousResult != null) {
      throw new KnownErrors.SchemaError("turnstile_previous_result requires turnstile_phase");
    }
    return assessment;
  }

  if (params.phase === "visible") {
    if (params.previousResult == null) {
      throw new KnownErrors.SchemaError("turnstile_previous_result is required when turnstile_phase is visible");
    }

    if (assessment.status !== "ok") {
      throw new KnownErrors.TurnstileChallengeRequired(params.previousResult);
    }

    return {
      status: params.previousResult,
      visibleChallengeResult: "ok",
    };
  }

  if (params.previousResult != null) {
    throw new KnownErrors.SchemaError("turnstile_previous_result is only allowed when turnstile_phase is visible");
  }

  if (assessment.status !== "ok") {
    throw new KnownErrors.TurnstileChallengeRequired(assessment.status);
  }

  return assessment;
}

export async function getRequestContextAndTurnstileAssessment(
  turnstile: TurnstileFlowRequest,
  expectedAction: TurnstileAction,
): Promise<{
  requestContext: BestEffortEndUserRequestContext,
  turnstileAssessment: SignUpTurnstileAssessment,
}> {
  const requestContext = await getBestEffortEndUserRequestContext();
  const turnstileAssessment = await verifyTurnstileTokenWithOptionalVisibleChallenge({
    token: turnstile.turnstile_token,
    remoteIp: requestContext.ipAddress,
    expectedAction,
    phase: turnstile.turnstile_phase,
    previousResult: turnstile.turnstile_previous_result,
  });
  return {
    requestContext,
    turnstileAssessment,
  };
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

    expect(postedSecret).toBe(turnstileDevelopmentKeys.secretKey);
  });
});

import.meta.vitest?.describe("verifyTurnstileTokenWithOptionalVisibleChallenge(...)", () => {
  import.meta.vitest?.test("preserves legacy behavior when no phase is provided", async ({ expect }) => {
    await expect(verifyTurnstileTokenWithOptionalVisibleChallenge({
      token: undefined,
      remoteIp: null,
      expectedAction: "send_magic_link_email",
      siteKey: "site-key",
      secretKey: "secret-key",
    })).resolves.toEqual({ status: "invalid" });
  });

  import.meta.vitest?.test("throws a challenge-required error for invisible failures", async ({ expect }) => {
    await expect(verifyTurnstileTokenWithOptionalVisibleChallenge({
      token: "invalid-token",
      remoteIp: null,
      expectedAction: "send_magic_link_email",
      phase: "invisible",
      siteKey: "site-key",
      secretKey: "secret-key",
      fetchImpl: async () => new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    })).rejects.toThrowError("An additional Turnstile challenge is required before sign-up can continue.");
  });

  import.meta.vitest?.test("returns a recovered assessment after a successful visible retry", async ({ expect }) => {
    await expect(verifyTurnstileTokenWithOptionalVisibleChallenge({
      token: "visible-token",
      remoteIp: null,
      expectedAction: "send_magic_link_email",
      phase: "visible",
      previousResult: "invalid",
      siteKey: "site-key",
      secretKey: "secret-key",
      fetchImpl: async () => new Response(JSON.stringify({ success: true, action: "send_magic_link_email" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    })).resolves.toEqual({
      status: "invalid",
      visibleChallengeResult: "ok",
    });
  });
});
