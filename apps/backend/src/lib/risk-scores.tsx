import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import type { SignUpRiskScoresCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import type { SignUpAuthMethod } from "@stackframe/stack-shared/dist/utils/auth-methods";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
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

let cachedEngine: SignUpRiskEngine | null = null;

function getPrivateEngineCandidates(): string[] {
  const cwd = process.cwd();
  return [
    path.resolve(cwd, PRIVATE_ENGINE_SUBPATH),
    path.resolve(cwd, "../..", PRIVATE_ENGINE_SUBPATH),
  ];
}

function extractEngine(mod: Record<string, unknown>, candidate: string): SignUpRiskEngine {
  const engine = mod.signUpRiskEngine;
  if (engine == null || typeof (engine as Record<string, unknown>).calculateRiskAssessment !== "function") {
    throw new StackAssertionError("Private engine module does not export a valid signUpRiskEngine", { candidate });
  }
  return engine as SignUpRiskEngine;
}

async function loadEngine(
  doImport: (path: string) => Promise<unknown> = (p) => import(/* webpackIgnore: true */ p),
): Promise<SignUpRiskEngine> {
  const candidates = getPrivateEngineCandidates();
  for (const candidate of candidates) {
    try {
      const mod = await doImport(candidate) as Record<string, unknown>;
      console.info("[risk-scores] Loaded private sign-up risk engine from", candidate);
      return extractEngine(mod, candidate);
    } catch (e: unknown) {
      const code = typeof e === "object" && e != null && "code" in e ? (e as { code: unknown }).code : undefined;
      if (code !== "MODULE_NOT_FOUND" && code !== "ERR_MODULE_NOT_FOUND") {
        throw e;
      }
    }
  }
  console.debug("[risk-scores] Private sign-up risk engine not found; using zero scores", { candidates });
  return {
    async calculateRiskAssessment() {
      return { scores: ZERO_SCORES, heuristicFacts: createNeutralSignUpHeuristicFacts(new Date()) };
    },
  };
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

import.meta.vitest?.test("loader falls back to zero scores when engine not found", async ({ expect }) => {
  const engine = await loadEngine(async () => {
    throw Object.assign(new Error("not found"), { code: "MODULE_NOT_FOUND" });
  });
  const result = await engine.calculateRiskAssessment(
    // any: context/deps don't matter for the fallback engine
    null as any, null as any,
  );
  expect(result.scores).toEqual({ bot: 0, free_trial_abuse: 0 });
});

import.meta.vitest?.test("loader rethrows non-module-not-found errors", async ({ expect }) => {
  await expect(loadEngine(async () => {
    throw new Error("private engine exploded");
  })).rejects.toThrow("private engine exploded");
});
