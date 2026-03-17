import { KnownErrors } from "@stackframe/stack-shared";
import { yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import {
  TurnstileAction,
  TurnstilePhase,
  TurnstileResult,
  turnstileDevelopmentKeys,
  turnstilePhaseValues,
} from "@stackframe/stack-shared/dist/utils/turnstile";
import { BestEffortEndUserRequestContext, getBestEffortEndUserRequestContext } from "./end-users";


// ── Types ──────────────────────────────────────────────────────────────

export type SignUpTurnstileAssessment = {
  status: TurnstileResult,
  visibleChallengeResult?: TurnstileResult,
};

export type TurnstileFlowRequest = {
  turnstile_token?: string,
  turnstile_phase?: TurnstilePhase,
};

export const turnstileFlowRequestSchemaFields = {
  turnstile_token: yupString().optional(),
  turnstile_phase: yupString().oneOf(turnstilePhaseValues).optional(),
} as const;

type SiteverifyResponse = {
  success: boolean,
  action?: string,
  hostname?: string,
  "error-codes"?: string[],
};


// ── Configuration ──────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 10_000;

function getSecretKey(override?: string): string {
  if (override) return override;
  const isDev = ["development", "test"].includes(getNodeEnvironment());
  return getEnvVariable("STACK_TURNSTILE_SECRET_KEY", isDev ? turnstileDevelopmentKeys.secretKey : "");
}

function getSiteverifyUrl(): string {
  return getEnvVariable("STACK_TURNSTILE_SITEVERIFY_URL", "https://challenges.cloudflare.com/turnstile/v0/siteverify");
}


// ── Siteverify ─────────────────────────────────────────────────────────

function isSiteverifyResponse(value: unknown): value is SiteverifyResponse {
  return value != null && typeof value === "object" && !Array.isArray(value)
    && "success" in value && typeof value.success === "boolean";
}

async function fetchSiteverify(token: string, remoteIp: string | null, secretKey: string): Promise<SiteverifyResponse> {
  const body = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp != null) {
    body.set("remoteip", remoteIp);
  }

  // No retry — a failed verification triggers a visible challenge on the client,
  // which is preferable to silently accepting a potentially-replayed token.
  const response = await fetch(getSiteverifyUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new StackAssertionError("Turnstile siteverify request failed", {
      status: response.status,
      statusText: response.statusText,
    });
  }

  const json = await response.json();
  if (!isSiteverifyResponse(json)) {
    throw new StackAssertionError("Turnstile siteverify response missing required fields", { json });
  }

  return json;
}


// ── Token verification ─────────────────────────────────────────────────

export async function verifyTurnstileToken(params: {
  token: string | undefined,
  remoteIp: string | null,
  expectedAction: TurnstileAction,
  secretKey?: string,
}): Promise<SignUpTurnstileAssessment> {
  const token = params.token?.trim() ?? "";
  if (!token) {
    return { status: "invalid" };
  }

  const result = await Result.fromThrowingAsync(
    () => fetchSiteverify(token, params.remoteIp, getSecretKey(params.secretKey)),
  );

  if (result.status === "error") {
    captureError("turnstile-siteverify-error", new StackAssertionError("Turnstile siteverify request failed", {
      cause: result.error,
      expectedAction: params.expectedAction,
    }));
    return { status: "error" };
  }

  const data = result.data;

  if (!data.success) {
    captureError("turnstile-siteverify-rejected", new StackAssertionError("Turnstile siteverify returned success=false", {
      errorCodes: data["error-codes"],
      expectedAction: params.expectedAction,
      receivedAction: data.action,
      hostname: data.hostname,
    }));
    return { status: "invalid" };
  }

  // TODO: validate hostname to prevent cross-environment token reuse.
  // See: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

  if (data.action != null && data.action !== params.expectedAction) {
    return { status: "invalid" };
  }

  return { status: "ok" };
}

export async function verifyTurnstileTokenWithOptionalVisibleChallenge(params: {
  token: string | undefined,
  remoteIp: string | null,
  expectedAction: TurnstileAction,
  phase?: "invisible" | "visible",
  secretKey?: string,
}): Promise<SignUpTurnstileAssessment> {
  const assessment = await verifyTurnstileToken(params);

  switch (params.phase) {
    case undefined: {
      // Legacy clients: return raw assessment without challenge flow
      return assessment;
    }
    case "invisible": {
      if (assessment.status !== "ok") {
        throw new KnownErrors.TurnstileChallengeRequired();
      }
      return assessment;
    }
    case "visible": {
      if (assessment.status !== "ok") {
        throw new KnownErrors.TurnstileChallengeFailed("Visible Turnstile challenge verification failed");
      }
      // Visible passed but invisible failed — always record "invalid" rather than
      // trusting a client-supplied value (a malicious client could claim "error"
      // to avoid the risk-score penalty that "invalid" carries).
      return { status: "invalid", visibleChallengeResult: "ok" };
    }
  }
}


// ── Convenience ────────────────────────────────────────────────────────

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
  });
  return { requestContext, turnstileAssessment };
}


// ── Tests ──────────────────────────────────────────────────────────────

import.meta.vitest?.describe("verifyTurnstileToken(...)", () => {
  const { vi, test, afterEach } = import.meta.vitest!;

  const stubFetch = (response: object, status = 200) => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    }));
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const baseParams = {
    remoteIp: null as string | null,
    expectedAction: "sign_up_with_credential" as const,
    secretKey: "secret-key",
  };

  test("returns invalid for empty or omitted token", async ({ expect }) => {
    await expect(verifyTurnstileToken({ ...baseParams, token: "" })).resolves.toEqual({ status: "invalid" });
    await expect(verifyTurnstileToken({ ...baseParams, token: undefined })).resolves.toEqual({ status: "invalid" });
  });

  test("maps siteverify success, rejection, and action mismatch", async ({ expect }) => {
    const cases = [
      { response: { success: true, action: "sign_up_with_credential" }, expected: "ok" },
      { response: { success: false, action: "sign_up_with_credential" }, expected: "invalid" },
      { response: { success: true, action: "oauth_authenticate" }, expected: "invalid" },
    ] as const;

    for (const { response, expected } of cases) {
      stubFetch(response);
      await expect(verifyTurnstileToken({ ...baseParams, token: "real-token", remoteIp: "127.0.0.1" }))
        .resolves.toEqual({ status: expected });
    }
  });

  test("returns error when siteverify network fails", async ({ expect }) => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    await expect(verifyTurnstileToken({ ...baseParams, token: "real-token", remoteIp: "127.0.0.1" }))
      .resolves.toEqual({ status: "error" });
  });

  test("uses development secret key when none is configured", async ({ expect }) => {
    const processEnv = Reflect.get(process, "env");
    const originalNodeEnv = Reflect.get(processEnv, "NODE_ENV");
    const originalKey = Reflect.get(processEnv, "STACK_TURNSTILE_SECRET_KEY");
    Reflect.set(processEnv, "NODE_ENV", "development");
    Reflect.set(processEnv, "STACK_TURNSTILE_SECRET_KEY", "");

    let postedSecret = "";
    try {
      vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body;
        if (!(body instanceof URLSearchParams)) throw new Error("Expected URLSearchParams body");
        postedSecret = body.get("secret") ?? "";
        return new Response(JSON.stringify({ success: true, action: "sign_up_with_credential" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      await expect(verifyTurnstileToken({ ...baseParams, token: "real-token", remoteIp: "127.0.0.1", secretKey: undefined }))
        .resolves.toEqual({ status: "ok" });
    } finally {
      Reflect.set(processEnv, "NODE_ENV", originalNodeEnv);
      Reflect.set(processEnv, "STACK_TURNSTILE_SECRET_KEY", originalKey);
    }

    expect(postedSecret).toBe(turnstileDevelopmentKeys.secretKey);
  });
});

import.meta.vitest?.describe("verifyTurnstileTokenWithOptionalVisibleChallenge(...)", () => {
  const { vi, test, afterEach } = import.meta.vitest!;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const baseParams = {
    remoteIp: null as string | null,
    expectedAction: "send_magic_link_email" as const,
    secretKey: "secret-key",
  };

  test("preserves legacy behavior when no phase is provided", async ({ expect }) => {
    await expect(verifyTurnstileTokenWithOptionalVisibleChallenge({ ...baseParams, token: undefined }))
      .resolves.toEqual({ status: "invalid" });
  });

  test("throws challenge-required for invisible failures", async ({ expect }) => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: false }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await expect(verifyTurnstileTokenWithOptionalVisibleChallenge({ ...baseParams, token: "bad", phase: "invisible" }))
      .rejects.toThrowError("An additional Turnstile challenge is required before sign-up can continue.");
  });

  test("returns recovered assessment after successful visible retry", async ({ expect }) => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, action: "send_magic_link_email" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await expect(verifyTurnstileTokenWithOptionalVisibleChallenge({ ...baseParams, token: "visible-token", phase: "visible" }))
      .resolves.toEqual({ status: "invalid", visibleChallengeResult: "ok" });
  });
});
