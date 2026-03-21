import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import type { SignUpRiskScoresCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import type { SignUpAuthMethod } from "@stackframe/stack-shared/dist/utils/auth-methods";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { checkEmailWithEmailable } from "./emailable";
import { createNeutralSignUpHeuristicFacts, type DerivedSignUpHeuristicFacts } from "./sign-up-heuristics";
import type { Tenancy } from "./tenancies";
import type { SignUpTurnstileAssessment } from "./turnstile";


// -- Types -------------------------------------------------------------------

export type SignUpRiskScores = SignUpRiskScoresCrud;

export type SignUpRiskScoreContext = {
  primaryEmail: string | null,
  primaryEmailVerified: boolean,
  authMethod: SignUpAuthMethod,
  oauthProvider: string | null,
  ipAddress: string | null,
  ipTrusted: boolean | null,
  turnstileAssessment: SignUpTurnstileAssessment,
};

export type SignUpRiskAssessment = {
  scores: SignUpRiskScores,
  heuristicFacts: DerivedSignUpHeuristicFacts,
};

export type SignUpRiskRecentStatsRequest = {
  signedUpAt: Date,
  signUpIp: string | null,
  signUpEmailBase: string | null,
  recentWindowHours: number,
  sameIpLimit: number,
  similarEmailLimit: number,
};

export type SignUpRiskRecentStats = {
  sameIpCount: number,
  similarEmailCount: number,
};

type SignUpRiskEngine = {
  calculateRiskAssessment: (
    context: SignUpRiskScoreContext,
    dependencies: {
      checkPrimaryEmailRisk: (email: string) => Promise<{ emailableScore: number | null }>,
      loadRecentSignUpStats: (request: SignUpRiskRecentStatsRequest) => Promise<SignUpRiskRecentStats>,
    },
  ) => Promise<SignUpRiskAssessment>,
};


// -- Private engine ----------------------------------------------------------

const ZERO_SCORES: SignUpRiskScores = { bot: 0, free_trial_abuse: 0 };

function createZeroRiskAssessment(now: Date): SignUpRiskAssessment {
  return { scores: ZERO_SCORES, heuristicFacts: createNeutralSignUpHeuristicFacts(now) };
}

const ZERO_SCORE_ENGINE: SignUpRiskEngine = {
  async calculateRiskAssessment() {
    return createZeroRiskAssessment(new Date());
  },
};

function isSignUpRiskEngine(value: unknown): value is SignUpRiskEngine {
  if (value == null || typeof value !== "object" || !("calculateRiskAssessment" in value)) {
    return false;
  }
  return typeof value.calculateRiskAssessment === "function";
}

let privateSignUpRiskEngine: SignUpRiskEngine = ZERO_SCORE_ENGINE;

try {
  const privateRiskScoreEngineModule = await import("../private/dist/sign-up-risk-engine.js");
  const maybePrivateSignUpRiskEngine =
    privateRiskScoreEngineModule == null || typeof privateRiskScoreEngineModule !== "object" || !("signUpRiskEngine" in privateRiskScoreEngineModule)
      ? null
      : privateRiskScoreEngineModule.signUpRiskEngine;

  if (!isSignUpRiskEngine(maybePrivateSignUpRiskEngine)) {
    captureError("sign-up-risk-engine-invalid", new StackAssertionError(
      "Private sign-up risk engine module did not export a valid signUpRiskEngine; using zero scores fallback",
      {
        privateEngineImportPath: "../private/dist/sign-up-risk-engine.js",
      },
    ));
  } else {
    privateSignUpRiskEngine = maybePrivateSignUpRiskEngine;
  }
} catch (error) {
  captureError("sign-up-risk-engine-load", new StackAssertionError(
    "Failed to import private sign-up risk engine; using zero scores fallback",
    {
      cause: error,
      privateEngineImportPath: "../private/dist/sign-up-risk-engine.js",
    },
  ));
}


// -- DB queries --------------------------------------------------------------

async function loadRecentSignUpStats(
  tenancy: Tenancy,
  request: SignUpRiskRecentStatsRequest,
): Promise<SignUpRiskRecentStats> {
  const prisma = await getPrismaClientForTenancy(tenancy);
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const windowStart = new Date(request.signedUpAt.getTime() - request.recentWindowHours * 60 * 60 * 1000);

  const [sameIpRows, similarEmailRows] = await Promise.all([
    request.signUpIp == null || request.sameIpLimit === 0
      ? []
      : prisma.$replica().$queryRaw<{ matched: number }[]>`
          SELECT 1 AS "matched"
          FROM ${sqlQuoteIdent(schema)}."ProjectUser"
          WHERE "tenancyId" = ${tenancy.id}::UUID
            AND "isAnonymous" = false
            AND "signedUpAt" >= ${windowStart}
            AND "signUpIp" = ${request.signUpIp}
          LIMIT ${request.sameIpLimit}
        `,

    request.signUpEmailBase == null || request.similarEmailLimit === 0
      ? []
      : prisma.$replica().$queryRaw<{ matched: number }[]>`
          SELECT 1 AS "matched"
          FROM ${sqlQuoteIdent(schema)}."ProjectUser"
          WHERE "tenancyId" = ${tenancy.id}::UUID
            AND "isAnonymous" = false
            AND "signedUpAt" >= ${windowStart}
            AND "signUpEmailBase" = ${request.signUpEmailBase}
          LIMIT ${request.similarEmailLimit}
        `,
  ]);

  return {
    sameIpCount: sameIpRows.length,
    similarEmailCount: similarEmailRows.length,
  };
}

function createDependencies(tenancy: Tenancy) {
  return {
    checkPrimaryEmailRisk: async (email: string) => ({
      emailableScore: (await checkEmailWithEmailable(email)).emailableScore,
    }),
    loadRecentSignUpStats: (request: SignUpRiskRecentStatsRequest) => loadRecentSignUpStats(tenancy, request),
  };
}

async function calculateRiskAssessmentWithFallback(
  engine: SignUpRiskEngine,
  context: SignUpRiskScoreContext,
  dependencies: Parameters<SignUpRiskEngine["calculateRiskAssessment"]>[1],
): Promise<SignUpRiskAssessment> {
  try {
    return await engine.calculateRiskAssessment(context, dependencies);
  } catch (error) {
    captureError("sign-up-risk-assessment-failed", new StackAssertionError(
      "Sign-up risk assessment failed; using zero scores fallback",
      {
        cause: error,
        privateEngineImportPath: "../private/dist/sign-up-risk-engine.js",
        context: {
          authMethod: context.authMethod,
          oauthProvider: context.oauthProvider,
          hasPrimaryEmail: context.primaryEmail != null,
          primaryEmailVerified: context.primaryEmailVerified,
          hasIpAddress: context.ipAddress != null,
          ipTrusted: context.ipTrusted,
          turnstileAssessment: context.turnstileAssessment,
        },
      },
    ));
    return createZeroRiskAssessment(new Date());
  }
}


// -- Public API --------------------------------------------------------------

export async function calculateSignUpRiskAssessment(
  tenancy: Tenancy,
  context: SignUpRiskScoreContext,
): Promise<SignUpRiskAssessment> {
  return await calculateRiskAssessmentWithFallback(privateSignUpRiskEngine, context, createDependencies(tenancy));
}

export async function calculateSignUpRiskScores(
  tenancy: Tenancy,
  context: SignUpRiskScoreContext,
): Promise<SignUpRiskScores> {
  return (await calculateSignUpRiskAssessment(tenancy, context)).scores;
}


// -- Tests -------------------------------------------------------------------

import.meta.vitest?.test("private sign-up risk engine resolves at module init", ({ expect }) => {
  expect(privateSignUpRiskEngine).not.toBe(ZERO_SCORE_ENGINE);
  expect(typeof privateSignUpRiskEngine.calculateRiskAssessment).toBe("function");
});

import.meta.vitest?.test("loaded private sign-up risk engine can calculate scores", async ({ expect }) => {
  const { vi } = import.meta.vitest!;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-20T00:00:00.000Z"));

  try {
    const assessment = await privateSignUpRiskEngine.calculateRiskAssessment({
      primaryEmail: null,
      primaryEmailVerified: false,
      authMethod: "password",
      oauthProvider: null,
      ipAddress: null,
      ipTrusted: null,
      turnstileAssessment: { status: "ok" },
    }, {
      checkPrimaryEmailRisk: async () => ({ emailableScore: null }),
      loadRecentSignUpStats: async () => ({ sameIpCount: 0, similarEmailCount: 0 }),
    });

    expect(assessment).toMatchInlineSnapshot(`
      {
        "heuristicFacts": {
          "emailBase": null,
          "emailNormalized": null,
          "signUpEmailBase": null,
          "signUpEmailNormalized": null,
          "signUpIp": null,
          "signUpIpTrusted": null,
          "signedUpAt": 2026-03-20T00:00:00.000Z,
        },
        "scores": {
          "bot": 0,
          "free_trial_abuse": 0,
        },
      }
    `);
  } finally {
    vi.useRealTimers();
  }
});

import.meta.vitest?.test("calculateRiskAssessmentWithFallback returns zero scores on engine error", async ({ expect }) => {
  const { vi } = import.meta.vitest!;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-20T00:00:00.000Z"));

  try {
    const assessment = await calculateRiskAssessmentWithFallback({
      async calculateRiskAssessment() { throw new Error("boom"); },
    }, {
      primaryEmail: "user@example.com",
      primaryEmailVerified: false,
      authMethod: "password",
      oauthProvider: null,
      ipAddress: "127.0.0.1",
      ipTrusted: true,
      turnstileAssessment: { status: "ok" },
    }, {
      checkPrimaryEmailRisk: async () => ({ emailableScore: null }),
      loadRecentSignUpStats: async () => ({ sameIpCount: 0, similarEmailCount: 0 }),
    });

    expect(assessment).toEqual(createZeroRiskAssessment(new Date("2026-03-20T00:00:00.000Z")));
  } finally {
    vi.useRealTimers();
  }
});
