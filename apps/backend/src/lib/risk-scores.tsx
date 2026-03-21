import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import type { SignUpRiskScoresCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import type { SignUpAuthMethod } from "@stackframe/stack-shared/dist/utils/auth-methods";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
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


// ── Private engine loader ──────────────────────────────────────────────

const ZERO_SCORES: SignUpRiskScores = { bot: 0, free_trial_abuse: 0 };
const PRIVATE_ENGINE_SUBPATH = "packages/private/dist/index.js";

function resolvePrivateEnginePath(): string | null {
  const cwd = process.cwd();
  for (const candidate of [
    path.resolve(cwd, PRIVATE_ENGINE_SUBPATH),
    path.resolve(cwd, "../..", PRIVATE_ENGINE_SUBPATH),
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const PRIVATE_ENGINE_PATH = resolvePrivateEnginePath();
const HAS_PRIVATE_ENGINE = PRIVATE_ENGINE_PATH != null;

let cachedEngine: SignUpRiskEngine | null = null;

async function loadEngine(): Promise<SignUpRiskEngine> {
  if (!HAS_PRIVATE_ENGINE) {
    console.debug("[risk-scores] Private sign-up risk engine not found; using zero scores");
    return {
      async calculateRiskAssessment() {
        return { scores: ZERO_SCORES, heuristicFacts: createNeutralSignUpHeuristicFacts(new Date()) };
      },
    };
  }

  const mod = await import(/* webpackIgnore: true */ PRIVATE_ENGINE_PATH) as Record<string, unknown>;
  const engine = mod.signUpRiskEngine;
  if (engine == null || typeof (engine as Record<string, unknown>).calculateRiskAssessment !== "function") {
    throw new StackAssertionError("Private engine module does not export a valid signUpRiskEngine", { path: PRIVATE_ENGINE_PATH });
  }
  console.info("[risk-scores] Loaded private sign-up risk engine from", PRIVATE_ENGINE_PATH);
  return engine as SignUpRiskEngine;
}

async function getEngine(): Promise<SignUpRiskEngine> {
  if (cachedEngine == null) {
    cachedEngine = await loadEngine();
  }
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


// ── Public API ─────────────────────────────────────────────────────────

export async function calculateSignUpRiskAssessment(
  tenancy: Tenancy,
  context: SignUpRiskScoreContext,
): Promise<SignUpRiskAssessment> {
  const engine = await getEngine();
  return await engine.calculateRiskAssessment(context, createDependencies(tenancy));
}

export async function calculateSignUpRiskScores(
  tenancy: Tenancy,
  context: SignUpRiskScoreContext,
): Promise<SignUpRiskScores> {
  return (await calculateSignUpRiskAssessment(tenancy, context)).scores;
}


// ── Tests ──────────────────────────────────────────────────────────────

import.meta.vitest?.test("resolvePrivateEnginePath finds the engine in the monorepo", ({ expect }) => {
  expect(HAS_PRIVATE_ENGINE).toBe(true);
  expect(PRIVATE_ENGINE_PATH).toMatch(/packages\/private\/dist\/index\.js$/);
});

import.meta.vitest?.test("loadEngine loads the real engine when available", async ({ expect }) => {
  const engine = await loadEngine();
  expect(typeof engine.calculateRiskAssessment).toBe("function");
});
