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

let cachedEnginePromise: Promise<SignUpRiskEngine> | null = null;

function isSignUpRiskEngine(value: unknown): value is SignUpRiskEngine {
  return value != null && typeof value === "object" && typeof (value as Record<string, unknown>).calculateRiskAssessment === "function";
}

async function loadEngine(): Promise<SignUpRiskEngine> {
  if (PRIVATE_ENGINE_PATH == null) {
    console.debug("[risk-scores] Private sign-up risk engine not found; using zero scores");
    return ZERO_SCORE_ENGINE;
  }

  return await loadEngineFromPath(PRIVATE_ENGINE_PATH);
}

async function loadEngineFromPath(privateEnginePath: string): Promise<SignUpRiskEngine> {
  let mod: Record<string, unknown>;
  try {
    mod = await import(/* webpackIgnore: true */ privateEnginePath) as Record<string, unknown>;
  } catch (error) {
    captureError("sign-up-risk-engine-load", new StackAssertionError(
      "Failed to import private sign-up risk engine; using zero scores fallback",
      {
        cause: error,
        path: privateEnginePath,
      },
    ));
    return ZERO_SCORE_ENGINE;
  }
  const engine = mod.signUpRiskEngine;
  if (!isSignUpRiskEngine(engine)) {
    captureError("sign-up-risk-engine-invalid", new StackAssertionError(
      "Private engine does not export a valid signUpRiskEngine; using zero scores fallback",
      { path: privateEnginePath },
    ));
    return ZERO_SCORE_ENGINE;
  }
  console.info("[risk-scores] Loaded private sign-up risk engine from", privateEnginePath);
  return engine;
}

async function getEngine(): Promise<SignUpRiskEngine> {
  if (cachedEnginePromise != null) return await cachedEnginePromise;

  const enginePromise = loadEngine();
  cachedEnginePromise = enginePromise;

  try {
    return await enginePromise;
  } catch (error) {
    if (cachedEnginePromise === enginePromise) {
      cachedEnginePromise = null;
    }
    throw error;
  }
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

import.meta.vitest?.test.skipIf(!PRIVATE_ENGINE_PATH)("PRIVATE_ENGINE_PATH resolves in the monorepo", ({ expect }) => {
  expect(PRIVATE_ENGINE_PATH).toMatch(/packages\/private\/dist\/index\.js$/);
});

import.meta.vitest?.test.skipIf(!PRIVATE_ENGINE_PATH)("getEngine loads the real engine when available", async ({ expect }) => {
  cachedEnginePromise = null;
  try {
    const engine = await getEngine();
    await engine.calculateRiskAssessment({
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
    expect(typeof engine.calculateRiskAssessment).toBe("function");
    expect(engine).not.toBe(ZERO_SCORE_ENGINE);
  } finally {
    cachedEnginePromise = null;
  }
});

import.meta.vitest?.test("loadEngine returns zero-score engine when private engine import fails", async ({ expect }) => {
  const missingPrivateEnginePath = path.join(process.cwd(), "__missing-risk-engine__.js");
  const engine = await loadEngineFromPath(missingPrivateEnginePath);
  expect(engine).toBe(ZERO_SCORE_ENGINE);
});

import.meta.vitest?.test("loadEngineFromPath returns zero-score engine when private engine export is invalid", async ({ expect }) => {
  const invalidPrivateEnginePath = path.join(process.cwd(), "__invalid-risk-engine__.mjs");
  const invalidPrivateEngineSource = "export const signUpRiskEngine = {};\n";
  fs.writeFileSync(invalidPrivateEnginePath, invalidPrivateEngineSource);

  try {
    const engine = await loadEngineFromPath(invalidPrivateEnginePath);
    expect(engine).toBe(ZERO_SCORE_ENGINE);
  } finally {
    fs.unlinkSync(invalidPrivateEnginePath);
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
