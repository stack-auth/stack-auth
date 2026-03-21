import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import type { SignUpRiskScoresCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import type { SignUpAuthMethod } from "@stackframe/stack-shared/dist/utils/auth-methods";
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

function createZeroRiskAssessment(now: Date): SignUpRiskAssessment {
  return {
    scores: { bot: 0, free_trial_abuse: 0 },
    heuristicFacts: createNeutralSignUpHeuristicFacts(now),
  };
}

const zeroSignUpRiskEngine: SignUpRiskEngine = {
  async calculateRiskAssessment() {
    return createZeroRiskAssessment(new Date());
  },
};

let signUpRiskEngine: SignUpRiskEngine = zeroSignUpRiskEngine;

try {
  const maybeSignUpRiskEngine: unknown = Reflect.get(await import("../private/dist/sign-up-risk-engine.js"), "signUpRiskEngine");
  if (typeof maybeSignUpRiskEngine === "object" && maybeSignUpRiskEngine != null && "calculateRiskAssessment" in maybeSignUpRiskEngine) {
    signUpRiskEngine = maybeSignUpRiskEngine as SignUpRiskEngine;
  }
} catch {
  console.warn("Failed to import private sign-up risk engine; using zero scores fallback");
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


// -- Public API --------------------------------------------------------------

export async function calculateSignUpRiskAssessment(
  tenancy: Tenancy,
  context: SignUpRiskScoreContext,
): Promise<SignUpRiskAssessment> {
  return await signUpRiskEngine.calculateRiskAssessment(context, createDependencies(tenancy));
}

export async function calculateSignUpRiskScores(
  tenancy: Tenancy,
  context: SignUpRiskScoreContext,
): Promise<SignUpRiskScores> {
  return (await calculateSignUpRiskAssessment(tenancy, context)).scores;
}

// -- Tests -------------------------------------------------------------------

import.meta.vitest?.test("private sign-up risk engine resolves at module init", ({ expect }) => {
  expect(signUpRiskEngine).not.toBe(zeroSignUpRiskEngine);
  expect(typeof signUpRiskEngine.calculateRiskAssessment).toBe("function");
});

import.meta.vitest?.test("loaded private sign-up risk engine can calculate scores", async ({ expect }) => {
  const { vi } = import.meta.vitest!;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-20T00:00:00.000Z"));

  try {
    const assessment = await signUpRiskEngine.calculateRiskAssessment({
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
