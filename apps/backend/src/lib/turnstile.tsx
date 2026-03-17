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
  hostname?: string,
  "error-codes"?: string[],
};

const TURNSTILE_FETCH_TIMEOUT_MS = 10_000;

function normalizeLegacyTurnstileToken(token: string | undefined): string {
  // Backward compatibility: older clients can omit Turnstile entirely.
  // Normalize that to an empty token so verification consistently maps it to "invalid".
  return token?.trim() ?? "";
}

function getTurnstileSecretKey(override?: string): string {
  if (override) return override;
  const isDevelopmentLike = ["development", "test"].includes(getNodeEnvironment());
  const defaultSecretKey = isDevelopmentLike ? turnstileDevelopmentKeys.secretKey : "";
  return getEnvVariable("STACK_TURNSTILE_SECRET_KEY", defaultSecretKey);
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
}): Promise<TurnstileSiteverifyResponse> {
  const body = new URLSearchParams({
    secret: params.secretKey,
    response: params.token,
  });
  if (params.remoteIp != null) {
    body.set("remoteip", params.remoteIp);
  }

  // We do not retry on transient errors — a failed verification triggers a visible challenge retry
  // on the client side, which is preferable to silently accepting a potentially-replayed token after
  // a server-side retry where the token has already been consumed by Cloudflare.
  const response = await fetch(getTurnstileSiteverifyUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(TURNSTILE_FETCH_TIMEOUT_MS),
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
  secretKey?: string,
}): Promise<SignUpTurnstileAssessment> {
  const token = normalizeLegacyTurnstileToken(params.token);
  if (!token) {
    return { status: "invalid" };
  }

  const secretKey = getTurnstileSecretKey(params.secretKey);
  const verificationResult = await Result.fromThrowingAsync(async () => await fetchTurnstileVerification({
    token,
    remoteIp: params.remoteIp,
    secretKey,
  }));

  if (verificationResult.status === "error") {
    captureError("turnstile-siteverify-error", new StackAssertionError("Turnstile siteverify request failed", {
      cause: verificationResult.error,
      expectedAction: params.expectedAction,
    }));
    return { status: "error" };
  }

  const siteverifyData = verificationResult.data;

  if (!siteverifyData.success) {
    return { status: "invalid" };
  }

  // TODO: validate hostname to prevent cross-environment token reuse.
  // See: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

  if (siteverifyData.action != null && siteverifyData.action !== params.expectedAction) {
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
  secretKey?: string,
}): Promise<SignUpTurnstileAssessment> {
  // Validate phase/previousResult constraints upfront
  if (params.phase === undefined && params.previousResult !== undefined) {
    throw new KnownErrors.SchemaError("turnstile_previous_result requires turnstile_phase");
  }
  if (params.phase === "visible" && params.previousResult === undefined) {
    throw new KnownErrors.SchemaError("turnstile_previous_result is required when turnstile_phase is visible");
  }
  if (params.phase === "invisible" && params.previousResult !== undefined) {
    throw new KnownErrors.SchemaError("turnstile_previous_result is only allowed when turnstile_phase is visible");
  }

  // Verify the token against Cloudflare
  const assessment = await verifyTurnstileToken(params);

  // Phase-specific behavior
  switch (params.phase) {
    case undefined: {
      // Legacy clients: return the raw assessment without challenge flow
      return assessment;
    }
    case "invisible": {
      // Invisible challenge failed — require a visible challenge from the client
      if (assessment.status !== "ok") {
        throw new KnownErrors.TurnstileChallengeRequired(assessment.status);
      }
      return assessment;
    }
    case "visible": {
      // Visible challenge failed — this is the last resort, fail hard
      if (assessment.status !== "ok") {
        throw new KnownErrors.TurnstileChallengeFailed("Visible Turnstile challenge verification failed");
      }
      // Visible passed — carry forward the original invisible result for risk scoring
      return {
        status: params.previousResult ?? (() => { throw new StackAssertionError("previousResult must be defined when phase is visible; validated above"); })(),
        visibleChallengeResult: "ok",
      };
    }
  }
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
  const mockFetch = (response: object, status = 200) => {
    return async () => new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };

  import.meta.vitest?.afterEach(() => {
    import.meta.vitest!.vi.restoreAllMocks();
    import.meta.vitest!.vi.unstubAllGlobals();
  });

  import.meta.vitest?.test("returns invalid when empty token is provided", async ({ expect }) => {
    await expect(verifyTurnstileToken({
      token: "",
      remoteIp: null,
      expectedAction: "sign_up_with_credential",
      secretKey: "secret-key",
    })).resolves.toEqual({ status: "invalid" });
  });

  import.meta.vitest?.test("treats an omitted legacy token as invalid", async ({ expect }) => {
    await expect(verifyTurnstileToken({
      token: undefined,
      remoteIp: null,
      expectedAction: "sign_up_with_credential",
      secretKey: "secret-key",
    })).resolves.toEqual({ status: "invalid" });
  });

  import.meta.vitest?.test("maps siteverify success, invalid, and action mismatch responses", async ({ expect }) => {
    const vi = import.meta.vitest!.vi;
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
      vi.stubGlobal("fetch", mockFetch(testCase.response));
      await expect(verifyTurnstileToken({
        token: "real-token",
        remoteIp: "127.0.0.1",
        expectedAction: "sign_up_with_credential",
        secretKey: "secret-key",
      })).resolves.toEqual({ status: testCase.expectedStatus });
    }
  });

  import.meta.vitest?.test("returns error when siteverify fails", async ({ expect }) => {
    const vi = import.meta.vitest!.vi;
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    await expect(verifyTurnstileToken({
      token: "real-token",
      remoteIp: "127.0.0.1",
      expectedAction: "sign_up_with_credential",
      secretKey: "secret-key",
    })).resolves.toEqual({ status: "error" });
  });

  import.meta.vitest?.test("falls back to the development Turnstile secret when none is configured", async ({ expect }) => {
    const vi = import.meta.vitest!.vi;
    const processEnv = Reflect.get(process, "env");

    const originalNodeEnv = Reflect.get(processEnv, "NODE_ENV");
    const originalSecretKey = Reflect.get(processEnv, "STACK_TURNSTILE_SECRET_KEY");
    Reflect.set(processEnv, "NODE_ENV", "development");
    Reflect.set(processEnv, "STACK_TURNSTILE_SECRET_KEY", "");

    let postedSecret = "";
    try {
      vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
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
          headers: { "Content-Type": "application/json" },
        });
      });

      await expect(verifyTurnstileToken({
        token: "real-token",
        remoteIp: "127.0.0.1",
        expectedAction: "sign_up_with_credential",
      })).resolves.toEqual({ status: "ok" });
    } finally {
      Reflect.set(processEnv, "NODE_ENV", originalNodeEnv);
      Reflect.set(processEnv, "STACK_TURNSTILE_SECRET_KEY", originalSecretKey);
    }

    expect(postedSecret).toBe(turnstileDevelopmentKeys.secretKey);
  });
});

import.meta.vitest?.describe("verifyTurnstileTokenWithOptionalVisibleChallenge(...)", () => {
  import.meta.vitest?.afterEach(() => {
    import.meta.vitest!.vi.restoreAllMocks();
    import.meta.vitest!.vi.unstubAllGlobals();
  });

  import.meta.vitest?.test("preserves legacy behavior when no phase is provided", async ({ expect }) => {
    await expect(verifyTurnstileTokenWithOptionalVisibleChallenge({
      token: undefined,
      remoteIp: null,
      expectedAction: "send_magic_link_email",
      secretKey: "secret-key",
    })).resolves.toEqual({ status: "invalid" });
  });

  import.meta.vitest?.test("throws a challenge-required error for invisible failures", async ({ expect }) => {
    const vi = import.meta.vitest!.vi;
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(verifyTurnstileTokenWithOptionalVisibleChallenge({
      token: "invalid-token",
      remoteIp: null,
      expectedAction: "send_magic_link_email",
      phase: "invisible",
      secretKey: "secret-key",
    })).rejects.toThrowError("An additional Turnstile challenge is required before sign-up can continue.");
  });

  import.meta.vitest?.test("returns a recovered assessment after a successful visible retry", async ({ expect }) => {
    const vi = import.meta.vitest!.vi;
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, action: "send_magic_link_email" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(verifyTurnstileTokenWithOptionalVisibleChallenge({
      token: "visible-token",
      remoteIp: null,
      expectedAction: "send_magic_link_email",
      phase: "visible",
      previousResult: "invalid",
      secretKey: "secret-key",
    })).resolves.toEqual({
      status: "invalid",
      visibleChallengeResult: "ok",
    });
  });
});
