import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import type { SignUpRiskScoresCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import type { SignUpAuthMethod } from "@stackframe/stack-shared/dist/utils/auth-methods";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import fs from "node:fs";
import path from "node:path";
import { checkEmailWithEmailable } from "./emailable";
import { createNeutralSignUpHeuristicFacts, type DerivedSignUpHeuristicFacts } from "./sign-up-heuristics";
import type { Tenancy } from "./tenancies";
import type { SignUpTurnstileAssessment } from "./turnstile";


// ── Types ──────────────────────────────────────────────────────────────

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


// ── Private engine ─────────────────────────────────────────────────────

const ZERO_SCORES: SignUpRiskScores = { bot: 0, free_trial_abuse: 0 };

export const PRIVATE_ENGINE_PATH: string | null = (() => {
  const cwd = process.cwd();
  for (const relative of ["packages/private/dist/index.js", "../../packages/private/dist/index.js"]) {
    const resolved = path.resolve(cwd, relative);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
})();

function createZeroRiskAssessment(now: Date): SignUpRiskAssessment {
  return { scores: ZERO_SCORES, heuristicFacts: createNeutralSignUpHeuristicFacts(now) };
}

const ZERO_SCORE_ENGINE: SignUpRiskEngine = {
  async calculateRiskAssessment() {
    return createZeroRiskAssessment(new Date());
  },
};

let cachedEngine: SignUpRiskEngine | null = null;

async function getEngine(): Promise<SignUpRiskEngine> {
  if (cachedEngine != null) return cachedEngine;

  if (PRIVATE_ENGINE_PATH == null) {
    console.debug("[risk-scores] Private sign-up risk engine not found; using zero scores");
    cachedEngine = ZERO_SCORE_ENGINE;
    return cachedEngine;
  }

  const mod = await import(/* webpackIgnore: true */ PRIVATE_ENGINE_PATH) as Record<string, unknown>;
  const engine = mod.signUpRiskEngine;
  if (engine == null || typeof (engine as Record<string, unknown>).calculateRiskAssessment !== "function") {
    throw new StackAssertionError("Private engine does not export a valid signUpRiskEngine", { path: PRIVATE_ENGINE_PATH });
  }
  console.info("[risk-scores] Loaded private sign-up risk engine from", PRIVATE_ENGINE_PATH);
  cachedEngine = engine as SignUpRiskEngine;
  return cachedEngine;
}


// ── DB queries ─────────────────────────────────────────────────────────

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
        privateEnginePath: PRIVATE_ENGINE_PATH,
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


// ── Public API ─────────────────────────────────────────────────────────

export async function calculateSignUpRiskAssessment(
  tenancy: Tenancy,
  context: SignUpRiskScoreContext,
): Promise<SignUpRiskAssessment> {
  const engine = await getEngine();
  return await calculateRiskAssessmentWithFallback(engine, context, createDependencies(tenancy));
}

export async function calculateSignUpRiskScores(
  tenancy: Tenancy,
  context: SignUpRiskScoreContext,
): Promise<SignUpRiskScores> {
  return (await calculateSignUpRiskAssessment(tenancy, context)).scores;
}


// ── Tests ──────────────────────────────────────────────────────────────

import.meta.vitest?.test("PRIVATE_ENGINE_PATH resolves in the monorepo", ({ expect }) => {
  expect(PRIVATE_ENGINE_PATH).toMatch(/packages\/private\/dist\/index\.js$/);
});

import.meta.vitest?.test("getEngine loads the real engine when available", async ({ expect }) => {
  cachedEngine = null;
  const engine = await getEngine();
  expect(typeof engine.calculateRiskAssessment).toBe("function");
  expect(engine).not.toBe(ZERO_SCORE_ENGINE);
  cachedEngine = null;
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
