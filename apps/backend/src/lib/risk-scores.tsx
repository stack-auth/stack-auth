import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import type { SignUpRiskScoresCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { SignUpAuthMethod } from "@stackframe/stack-shared/dist/utils/auth-methods";
import { checkEmailWithEmailable, type EmailableCheckResult } from "./emailable";
import { riskScoreWeights, riskScoreThresholds } from "@stackframe/stack-shared/dist/utils/risk-score-weights";
import { Tenancy } from "./tenancies";
import { SignUpTurnstileAssessment } from "./turnstile";
import { DerivedSignUpHeuristicFacts, deriveSignUpHeuristicFacts } from "./sign-up-heuristics";


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


// ── Score arithmetic helpers ───────────────────────────────────────────

const ZERO: SignUpRiskScores = { bot: 0, free_trial_abuse: 0 };

function scaleScores(scores: SignUpRiskScores, factor: number): SignUpRiskScores {
  return {
    bot: Math.round(scores.bot * factor),
    free_trial_abuse: Math.round(scores.free_trial_abuse * factor),
  };
}

function scaleRepeatedSignalCount(params: {
  matchCount: number,
  minMatches: number,
  maxMatchesForFullPenalty: number,
}): number {
  if (params.matchCount < params.minMatches) {
    return 0;
  }
  if (params.maxMatchesForFullPenalty < params.minMatches) {
    throw new Error("Expected maxMatchesForFullPenalty to be >= minMatches");
  }

  const clampedMatchCount = Math.min(params.matchCount, params.maxMatchesForFullPenalty);
  const penaltySteps = params.maxMatchesForFullPenalty - params.minMatches + 1;
  const matchedSteps = clampedMatchCount - params.minMatches + 1;

  return matchedSteps / penaltySteps;
}

function sumScores(...contributions: SignUpRiskScores[]): SignUpRiskScores {
  return {
    bot: Math.min(100, contributions.reduce((s, c) => s + c.bot, 0)),
    free_trial_abuse: Math.min(100, contributions.reduce((s, c) => s + c.free_trial_abuse, 0)),
  };
}


// ── Per-signal contribution functions ──────────────────────────────────

function getEmailableContribution(result: EmailableCheckResult): SignUpRiskScores {
  if (result.emailableScore == null) return ZERO;
  return scaleScores(riskScoreWeights.emailable, 1 - result.emailableScore / 100);
}

function getSameIpContribution(matchCount: number, ipTrusted: boolean | null): SignUpRiskScores {
  const sameIpWeight = ipTrusted === true ? riskScoreWeights.sameIp.trusted : riskScoreWeights.sameIp.spoofable;
  const factor = scaleRepeatedSignalCount({
    matchCount,
    minMatches: riskScoreThresholds.sameIpMinMatches,
    maxMatchesForFullPenalty: riskScoreThresholds.sameIpMaxMatchesForFullPenalty,
  });
  return factor === 0 ? ZERO : scaleScores(sameIpWeight, factor);
}

function getSimilarEmailContribution(matched: boolean): SignUpRiskScores {
  return matched ? riskScoreWeights.similarEmail : ZERO;
}

function getTurnstileContribution(assessment: SignUpTurnstileAssessment): SignUpRiskScores {
  // The invisible check initially failed (user recovered via visible CAPTCHA to reach this point).
  if (assessment.status === "invalid") return riskScoreWeights.turnstile;
  return ZERO;
}


// ── Recent sign-up stats (DB) ──────────────────────────────────────────

type RecentSignUpStats = {
  sameIpCount: number,
  similarEmailCount: number,
};

async function loadRecentSignUpStats(tenancy: Tenancy, facts: DerivedSignUpHeuristicFacts): Promise<RecentSignUpStats> {
  const prisma = await getPrismaClientForTenancy(tenancy);
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const windowStart = new Date(facts.signUpAt.getTime() - riskScoreThresholds.recentWindowHours * 60 * 60 * 1000);

  const [sameIpRows, similarEmailRows] = await Promise.all([
    facts.signUpIp == null
      ? []
      : prisma.$replica().$queryRaw<{ matched: number }[]>`
          SELECT 1 AS "matched"
          FROM ${sqlQuoteIdent(schema)}."ProjectUser"
          WHERE "tenancyId" = ${tenancy.id}::UUID
            AND "signUpAt" >= ${windowStart}
            AND "signUpIp" = ${facts.signUpIp}
          LIMIT ${riskScoreThresholds.sameIpMaxMatchesForFullPenalty}
        `,

    facts.signUpEmailBase == null
      ? []
      : prisma.$replica().$queryRaw<{ matched: number }[]>`
          SELECT 1 AS "matched"
          FROM ${sqlQuoteIdent(schema)}."ProjectUser"
          WHERE "tenancyId" = ${tenancy.id}::UUID
            AND "signUpAt" >= ${windowStart}
            AND "signUpEmailBase" = ${facts.signUpEmailBase}
          LIMIT ${riskScoreThresholds.similarEmailMinMatches}
        `,
  ]);

  return {
    sameIpCount: sameIpRows.length,
    similarEmailCount: similarEmailRows.length,
  };
}


// ── Public API ─────────────────────────────────────────────────────────

export async function calculateSignUpRiskAssessment(
  tenancy: Tenancy,
  context: SignUpRiskScoreContext,
): Promise<SignUpRiskAssessment> {
  const heuristicFacts = deriveSignUpHeuristicFacts({
    primaryEmail: context.primaryEmail,
    ipAddress: context.ipAddress,
    ipTrusted: context.ipTrusted,
  });

  const [stats, emailableResult] = await Promise.all([
    loadRecentSignUpStats(tenancy, heuristicFacts),
    context.primaryEmail == null
      ? { status: "ok" as const, emailableScore: null }
      : checkEmailWithEmailable(context.primaryEmail),
  ]);

  const similarEmailMatched = heuristicFacts.signUpEmailBase != null
    && stats.similarEmailCount >= riskScoreThresholds.similarEmailMinMatches;

  const scores = sumScores(
    getEmailableContribution(emailableResult),
    getSameIpContribution(heuristicFacts.signUpIp == null ? 0 : stats.sameIpCount, context.ipTrusted),
    getSimilarEmailContribution(similarEmailMatched),
    getTurnstileContribution(context.turnstileAssessment),
  );

  return { scores, heuristicFacts };
}

export async function calculateSignUpRiskScores(tenancy: Tenancy, context: SignUpRiskScoreContext): Promise<SignUpRiskScores> {
  return (await calculateSignUpRiskAssessment(tenancy, context)).scores;
}


// ── Tests ──────────────────────────────────────────────────────────────

import.meta.vitest?.test("scaleScores", ({ expect }) => {
  expect(scaleScores({ bot: 100, free_trial_abuse: 80 }, 0)).toEqual({ bot: 0, free_trial_abuse: 0 });
  expect(scaleScores({ bot: 100, free_trial_abuse: 80 }, 1)).toEqual({ bot: 100, free_trial_abuse: 80 });
  expect(scaleScores({ bot: 100, free_trial_abuse: 80 }, 0.5)).toEqual({ bot: 50, free_trial_abuse: 40 });
});

import.meta.vitest?.test("scaleRepeatedSignalCount", ({ expect }) => {
  const sameIpMaxMatchesForFullPenalty = riskScoreThresholds.sameIpMaxMatchesForFullPenalty;

  expect(scaleRepeatedSignalCount({
    matchCount: 0,
    minMatches: 1,
    maxMatchesForFullPenalty: sameIpMaxMatchesForFullPenalty,
  })).toBe(0);
  expect(scaleRepeatedSignalCount({
    matchCount: 1,
    minMatches: 1,
    maxMatchesForFullPenalty: sameIpMaxMatchesForFullPenalty,
  })).toBe(1 / sameIpMaxMatchesForFullPenalty);
  expect(scaleRepeatedSignalCount({
    matchCount: 2,
    minMatches: 1,
    maxMatchesForFullPenalty: sameIpMaxMatchesForFullPenalty,
  })).toBe(2 / sameIpMaxMatchesForFullPenalty);
  expect(scaleRepeatedSignalCount({
    matchCount: sameIpMaxMatchesForFullPenalty,
    minMatches: 1,
    maxMatchesForFullPenalty: sameIpMaxMatchesForFullPenalty,
  })).toBe(1);
  expect(scaleRepeatedSignalCount({
    matchCount: 99,
    minMatches: 1,
    maxMatchesForFullPenalty: sameIpMaxMatchesForFullPenalty,
  })).toBe(1);
});

import.meta.vitest?.test("sumScores clamps to 100", ({ expect }) => {
  expect(sumScores({ bot: 80, free_trial_abuse: 60 }, { bot: 50, free_trial_abuse: 50 }))
    .toEqual({ bot: 100, free_trial_abuse: 100 });
});

import.meta.vitest?.test("getSameIpContribution", ({ expect }) => {
  const firstMatchFactor = scaleRepeatedSignalCount({
    matchCount: 1,
    minMatches: riskScoreThresholds.sameIpMinMatches,
    maxMatchesForFullPenalty: riskScoreThresholds.sameIpMaxMatchesForFullPenalty,
  });
  const secondMatchFactor = scaleRepeatedSignalCount({
    matchCount: 2,
    minMatches: riskScoreThresholds.sameIpMinMatches,
    maxMatchesForFullPenalty: riskScoreThresholds.sameIpMaxMatchesForFullPenalty,
  });

  expect(getSameIpContribution(0, true)).toEqual(ZERO);
  expect(getSameIpContribution(1, true)).toEqual(scaleScores(riskScoreWeights.sameIp.trusted, firstMatchFactor));
  expect(getSameIpContribution(2, false)).toEqual(scaleScores(riskScoreWeights.sameIp.spoofable, secondMatchFactor));
  expect(getSameIpContribution(riskScoreThresholds.sameIpMaxMatchesForFullPenalty, false)).toEqual(riskScoreWeights.sameIp.spoofable);
  expect(getSameIpContribution(10, null)).toEqual(riskScoreWeights.sameIp.spoofable);
});

import.meta.vitest?.test("getTurnstileContribution", ({ expect }) => {
  expect(getTurnstileContribution({ status: "ok" })).toEqual(ZERO);
  expect(getTurnstileContribution({ status: "error" })).toEqual(ZERO);
  expect(getTurnstileContribution({ status: "invalid" })).toEqual(riskScoreWeights.turnstile);
  expect(getTurnstileContribution({ status: "invalid", visibleChallengeResult: "ok" })).toEqual(riskScoreWeights.turnstile);
});

import.meta.vitest?.test("getEmailableContribution", ({ expect }) => {
  expect(getEmailableContribution({ status: "error", error: new Error("unavailable"), emailableScore: null })).toEqual(ZERO);
  expect(getEmailableContribution({ status: "ok", emailableScore: null })).toEqual(ZERO);
  expect(getEmailableContribution({
    status: "not-deliverable",
    emailableResponse: { state: "undeliverable", disposable: false, score: null },
    emailableScore: null,
  })).toEqual(ZERO);

  expect(getEmailableContribution({ status: "ok", emailableScore: 100 })).toEqual(ZERO);
  expect(getEmailableContribution({ status: "ok", emailableScore: 0 })).toEqual(riskScoreWeights.emailable);
  expect(getEmailableContribution({ status: "ok", emailableScore: 50 })).toEqual(
    scaleScores(riskScoreWeights.emailable, 0.5),
  );

  expect(getEmailableContribution({
    status: "not-deliverable",
    emailableResponse: { state: "undeliverable", disposable: false, score: 10 },
    emailableScore: 10,
  })).toEqual(scaleScores(riskScoreWeights.emailable, 0.9));
});

import.meta.vitest?.test("worst-case scenario produces exactly 100", ({ expect }) => {
  const worstCase = sumScores(
    riskScoreWeights.emailable,
    riskScoreWeights.sameIp.trusted,
    riskScoreWeights.similarEmail,
    riskScoreWeights.turnstile,
  );
  expect(worstCase).toEqual({ bot: 100, free_trial_abuse: 100 });
});
