import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import type { SignUpRiskScoresCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { isIpAddress } from "@stackframe/stack-shared/dist/utils/ips";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { createJiti } from "jiti";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkEmailWithEmailable } from "./emailable";
import { normalizeEmail } from "./emails";
import { createNeutralSignUpHeuristicFacts, type DerivedSignUpHeuristicFacts } from "./sign-up-heuristics";
import type { Tenancy } from "./tenancies";
import type { SignUpTurnstileAssessment } from "./turnstile";
import type { SignUpAuthMethod } from "@stackframe/stack-shared/dist/utils/auth-methods";


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

export type SignUpRiskEngineDependencies = {
  now: () => Date,
  normalizeEmail: (email: string) => string,
  isIpAddress: (ipAddress: string) => boolean,
  createAssertionError: (message: string, details: Record<string, unknown>) => Error,
  checkPrimaryEmailRisk: (primaryEmail: string) => Promise<{ emailableScore: number | null }>,
  loadRecentSignUpStats: (request: SignUpRiskRecentStatsRequest) => Promise<SignUpRiskRecentStats>,
};

export type SignUpRiskEngine = {
  calculateRiskAssessment: (
    context: SignUpRiskScoreContext,
    dependencies: SignUpRiskEngineDependencies,
  ) => Promise<SignUpRiskAssessment>,
};


// ── Fallback engine ────────────────────────────────────────────────────

const ZERO_SCORES: SignUpRiskScores = { bot: 0, free_trial_abuse: 0 };

const fallbackSignUpRiskEngine: SignUpRiskEngine = {
  async calculateRiskAssessment(_context, deps) {
    return {
      scores: ZERO_SCORES,
      heuristicFacts: createNeutralSignUpHeuristicFacts(deps.now()),
    };
  },
};


// ── Private engine loader ──────────────────────────────────────────────

const CANDIDATE_SUBPATHS = [
  "dist/sign-up-risk-engine.js",
  "src/sign-up-risk-engine.ts",
] as const;

const _testOverrides = {
  rootPath: null as string | null,
  importer: null as ((modulePath: string) => Promise<unknown>) | null,
};

let cachedEngine: Promise<SignUpRiskEngine> | null = null;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isSignUpRiskEngine(value: unknown): value is SignUpRiskEngine {
  return typeof value === "object"
    && value !== null
    && "calculateRiskAssessment" in value
    && typeof (value as Record<string, unknown>).calculateRiskAssessment === "function";
}

function getNestedValue(obj: unknown, key: string): unknown {
  if (typeof obj === "object" && obj !== null && key in obj) {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

function extractEngine(mod: unknown): SignUpRiskEngine {
  const defaultExport = getNestedValue(mod, "default");

  const candidates = [
    mod,
    getNestedValue(mod, "signUpRiskEngine"),
    defaultExport,
    getNestedValue(defaultExport, "signUpRiskEngine"),
  ];

  for (const candidate of candidates) {
    if (isSignUpRiskEngine(candidate)) {
      return candidate;
    }
  }

  throw new Error("Private sign-up risk module does not export a valid signUpRiskEngine");
}

async function loadEngine(): Promise<SignUpRiskEngine> {
  const root = _testOverrides.rootPath ?? path.resolve(process.cwd(), "packages/private");
  if (!await fileExists(root)) {
    return fallbackSignUpRiskEngine;
  }

  for (const subpath of CANDIDATE_SUBPATHS) {
    const fullPath = path.join(root, subpath);
    if (!await fileExists(fullPath)) {
      continue;
    }

    const importer = _testOverrides.importer ?? (async (p: string) => {
      const jiti = createJiti(import.meta.url, { cache: false });
      return await jiti.import(p);
    });

    return extractEngine(await importer(fullPath));
  }

  return fallbackSignUpRiskEngine;
}

function getEngine(): Promise<SignUpRiskEngine> {
  cachedEngine ??= loadEngine();
  return cachedEngine;
}

function resetEngineForTests() {
  cachedEngine = null;
  _testOverrides.rootPath = null;
  _testOverrides.importer = null;
}


// ── DB queries for the private engine ──────────────────────────────────

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

function createDependencies(tenancy: Tenancy): SignUpRiskEngineDependencies {
  return {
    now: () => new Date(),
    normalizeEmail,
    isIpAddress,
    createAssertionError: (message, details) => new StackAssertionError(message, details),
    checkPrimaryEmailRisk: async (email) => ({
      emailableScore: (await checkEmailWithEmailable(email)).emailableScore,
    }),
    loadRecentSignUpStats: (request) => loadRecentSignUpStats(tenancy, request),
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

export async function calculateSignUpRiskScores(tenancy: Tenancy, context: SignUpRiskScoreContext): Promise<SignUpRiskScores> {
  return (await calculateSignUpRiskAssessment(tenancy, context)).scores;
}


// ── Tests ──────────────────────────────────────────────────────────────

import.meta.vitest?.test("fallback engine returns zero scores", async ({ expect }) => {
  const now = new Date("2026-03-11T00:00:00.000Z");
  const assessment = await fallbackSignUpRiskEngine.calculateRiskAssessment({
    primaryEmail: "user@example.com",
    primaryEmailVerified: false,
    authMethod: "password",
    oauthProvider: null,
    ipAddress: "127.0.0.1",
    ipTrusted: true,
    turnstileAssessment: { status: "invalid" },
  }, {
    now: () => now,
    normalizeEmail,
    isIpAddress,
    createAssertionError: (msg, details) => new StackAssertionError(msg, details),
    checkPrimaryEmailRisk: async () => ({ emailableScore: 100 }),
    loadRecentSignUpStats: async () => ({ sameIpCount: 10, similarEmailCount: 10 }),
  });

  expect(assessment).toEqual({
    scores: ZERO_SCORES,
    heuristicFacts: createNeutralSignUpHeuristicFacts(now),
  });
});

import.meta.vitest?.test("loader falls back when private submodule is absent", async ({ expect }) => {
  resetEngineForTests();
  _testOverrides.rootPath = path.join(process.cwd(), "packages", `private-missing-${Date.now()}`);

  try {
    expect(await getEngine()).toBe(fallbackSignUpRiskEngine);
  } finally {
    resetEngineForTests();
  }
});

import.meta.vitest?.test("loader rethrows private engine import errors", async ({ expect }) => {
  resetEngineForTests();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "private-risk-engine-"));

  try {
    await fs.mkdir(path.join(tempRoot, "dist"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "dist", "sign-up-risk-engine.js"), "export {};\n");

    _testOverrides.rootPath = tempRoot;
    _testOverrides.importer = async () => {
      throw new Error("private engine exploded");
    };

    await expect(getEngine()).rejects.toThrow("private engine exploded");
  } finally {
    resetEngineForTests();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
