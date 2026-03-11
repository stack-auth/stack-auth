import { getPrismaClientForTenancy } from "@/prisma-client";
import type { SignUpRiskScoresCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { SignUpAuthMethod } from "@stackframe/stack-shared/dist/utils/auth-methods";
import { checkEmailWithEmailable, type EmailableCheckResult } from "./emailable";
import { riskScoreWeights, riskScoreThresholds } from "./risk-score-weights";
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

function scaleScores(weights: SignUpRiskScores, factor: number): SignUpRiskScores {
  return {
    bot: Math.round(weights.bot * factor),
    free_trial_abuse: Math.round(weights.free_trial_abuse * factor),
  };
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

function getSameIpContribution(matched: boolean, ipTrusted: boolean | null): SignUpRiskScores {
  if (!matched) return ZERO;
  return ipTrusted === true ? riskScoreWeights.sameIp.trusted : riskScoreWeights.sameIp.spoofable;
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
  const windowStart = new Date(facts.signUpAt.getTime() - riskScoreThresholds.recentWindowHours * 60 * 60 * 1000);

  const [sameIpCount, similarEmailCount] = await Promise.all([
    facts.signUpIp == null
      ? 0
      : prisma.projectUser
        .findMany({
          where: {
            tenancyId: tenancy.id,
            signUpAt: { gte: windowStart },
            signUpIp: facts.signUpIp,
          },
          select: { projectUserId: true },
          take: riskScoreThresholds.sameIpMinMatches,
        })
        .then((rows) => rows.length),

    facts.signUpEmailBase == null || facts.signUpEmailNormalized == null
      ? 0
      : prisma.projectUser
        .findMany({
          where: {
            tenancyId: tenancy.id,
            signUpAt: { gte: windowStart },
            signUpEmailBase: facts.signUpEmailBase,
            AND: [
              { signUpEmailNormalized: { not: null } },
              { signUpEmailNormalized: { not: facts.signUpEmailNormalized } },
            ],
          },
          select: { projectUserId: true },
          take: riskScoreThresholds.similarEmailMinMatches,
        })
        .then((rows) => rows.length),
  ]);

  return { sameIpCount, similarEmailCount };
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

  const sameIpMatched = heuristicFacts.signUpIp != null && stats.sameIpCount >= riskScoreThresholds.sameIpMinMatches;
  const similarEmailMatched = heuristicFacts.signUpEmailBase != null
    && heuristicFacts.signUpEmailNormalized != null
    && stats.similarEmailCount >= riskScoreThresholds.similarEmailMinMatches;

  const scores = sumScores(
    getEmailableContribution(emailableResult),
    getSameIpContribution(sameIpMatched, context.ipTrusted),
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

import.meta.vitest?.test("sumScores clamps to 100", ({ expect }) => {
  expect(sumScores({ bot: 80, free_trial_abuse: 60 }, { bot: 50, free_trial_abuse: 50 }))
    .toEqual({ bot: 100, free_trial_abuse: 100 });
});

import.meta.vitest?.test("getSameIpContribution", ({ expect }) => {
  expect(getSameIpContribution(false, true)).toEqual(ZERO);
  expect(getSameIpContribution(true, true)).toEqual(riskScoreWeights.sameIp.trusted);
  expect(getSameIpContribution(true, false)).toEqual(riskScoreWeights.sameIp.spoofable);
  expect(getSameIpContribution(true, null)).toEqual(riskScoreWeights.sameIp.spoofable);
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
