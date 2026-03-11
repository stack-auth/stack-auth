import { getPrismaClientForTenancy } from "@/prisma-client";
import type { SignUpRiskScoresCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { SignUpAuthMethod } from "@stackframe/stack-shared/dist/utils/auth-methods";
import { checkEmailWithEmailable, type EmailableCheckResult } from "./emailable";
import { Tenancy } from "./tenancies";
import { SignUpTurnstileAssessment } from "./turnstile";
import { DerivedSignUpHeuristicFacts, deriveSignUpHeuristicFacts } from "./sign-up-heuristics";

function parseWeight(envName: string, defaultValue: number): number {
  const raw = getEnvVariable(envName, String(defaultValue));
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new StackAssertionError(`Invalid ${envName}: expected integer 0-100, got "${raw}"`);
  }
  return parsed;
}

function parsePositiveInteger(envName: string, defaultValue: number): number {
  const raw = getEnvVariable(envName, String(defaultValue));
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new StackAssertionError(`Invalid ${envName}: expected integer >=1, got "${raw}"`);
  }
  return parsed;
}

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

const recentWindowHours = parsePositiveInteger("STACK_RISK_SIGN_UP_RECENT_WINDOW_HOURS", 24);
const sameIpMinimumMatches = parsePositiveInteger("STACK_RISK_SAME_IP_MIN_RECENT_MATCHES", 1);
const similarEmailMinimumMatches = parsePositiveInteger("STACK_RISK_SIMILAR_EMAIL_MIN_RECENT_MATCHES", 1);

const trustedSameIpWeights = {
  bot: parseWeight("STACK_RISK_BOT_TRUSTED_SAME_IP_WEIGHT", 35),
  free_trial_abuse: parseWeight("STACK_RISK_FTA_TRUSTED_SAME_IP_WEIGHT", 70),
} as const;

const spoofableSameIpWeights = {
  bot: parseWeight("STACK_RISK_BOT_SPOOFABLE_SAME_IP_WEIGHT", 15),
  free_trial_abuse: parseWeight("STACK_RISK_FTA_SPOOFABLE_SAME_IP_WEIGHT", 35),
} as const;

const similarEmailWeights = {
  bot: parseWeight("STACK_RISK_BOT_SIMILAR_EMAIL_WEIGHT", 20),
  free_trial_abuse: parseWeight("STACK_RISK_FTA_SIMILAR_EMAIL_WEIGHT", 60),
} as const;

const disposableEmailWeights = {
  bot: parseWeight("STACK_RISK_BOT_DISPOSABLE_EMAIL_WEIGHT", 100),
  free_trial_abuse: parseWeight("STACK_RISK_FTA_DISPOSABLE_EMAIL_WEIGHT", 100),
} as const;

const turnstileFailedWeights = {
  bot: parseWeight("STACK_RISK_BOT_TURNSTILE_FAILED_WEIGHT", 80),
  free_trial_abuse: parseWeight("STACK_RISK_FTA_TURNSTILE_FAILED_WEIGHT", 40),
} as const;

const turnstileRecoveredWeights = {
  bot: parseWeight("STACK_RISK_BOT_TURNSTILE_RECOVERED_WEIGHT", 40),
  free_trial_abuse: parseWeight("STACK_RISK_FTA_TURNSTILE_RECOVERED_WEIGHT", 20),
} as const;

function clampRiskScore(score: number): number {
  return Math.min(100, Math.max(0, score));
}

function getRecentSameIpWeights(ipTrusted: boolean | null): SignUpRiskScores {
  const weights = ipTrusted === true ? trustedSameIpWeights : spoofableSameIpWeights;
  return {
    bot: weights.bot,
    free_trial_abuse: weights.free_trial_abuse,
  };
}

function getTurnstileWeights(turnstileAssessment: SignUpTurnstileAssessment): SignUpRiskScores {
  if (turnstileAssessment.status === "invalid") {
    if (turnstileAssessment.visibleChallengeResult === "ok") {
      return {
        bot: turnstileRecoveredWeights.bot,
        free_trial_abuse: turnstileRecoveredWeights.free_trial_abuse,
      };
    }

    return {
      bot: turnstileFailedWeights.bot,
      free_trial_abuse: turnstileFailedWeights.free_trial_abuse,
    };
  }

  return {
    bot: 0,
    free_trial_abuse: 0,
  };
}

function getDisposableEmailContribution(emailableResult: EmailableCheckResult): SignUpRiskScores {
  const emailableScore = emailableResult.emailableScore;

  // Use emailable score (0-100, higher = more deliverable) for granular contribution.
  // When score is available, scale the weight: contribution = weight * (1 - score/100).
  // When status is "not-deliverable", enforce at least half the weight as a floor.
  // When Emailable is unavailable, treat that as neutral so external outages do not block signups.
  if (emailableScore != null) {
    const scaleFactor = 1 - emailableScore / 100;
    if (emailableResult.status === "not-deliverable") {
      return {
        bot: Math.round(Math.max(disposableEmailWeights.bot * 0.5, disposableEmailWeights.bot * scaleFactor)),
        free_trial_abuse: Math.round(Math.max(disposableEmailWeights.free_trial_abuse * 0.5, disposableEmailWeights.free_trial_abuse * scaleFactor)),
      };
    }

    return {
      bot: Math.round(disposableEmailWeights.bot * scaleFactor),
      free_trial_abuse: Math.round(disposableEmailWeights.free_trial_abuse * scaleFactor),
    };
  }

  if (emailableResult.status === "not-deliverable") {
    return {
      bot: disposableEmailWeights.bot,
      free_trial_abuse: disposableEmailWeights.free_trial_abuse,
    };
  }

  return {
    bot: 0,
    free_trial_abuse: 0,
  };
}

type RecentSignUpStats = {
  sameIpRecentCount: number,
  similarEmailRecentCount: number,
};

async function loadRecentSignUpStats(
  tenancy: Tenancy,
  heuristicFacts: DerivedSignUpHeuristicFacts,
): Promise<RecentSignUpStats> {
  const prisma = await getPrismaClientForTenancy(tenancy);
  const windowStart = new Date(heuristicFacts.signUpAt.getTime() - recentWindowHours * 60 * 60 * 1000);

  const sameIpPromise = heuristicFacts.signUpIp == null
    ? Promise.resolve(0)
    : prisma.projectUser
      .findMany({
        where: {
          tenancyId: tenancy.id,
          signUpAt: {
            gte: windowStart,
          },
          signUpIp: heuristicFacts.signUpIp,
        },
        select: {
          projectUserId: true,
        },
        take: sameIpMinimumMatches,
      })
      .then((rows) => rows.length);

  const similarEmailPromise = heuristicFacts.signUpEmailBase == null || heuristicFacts.signUpEmailNormalized == null
    ? Promise.resolve(0)
    : prisma.projectUser
      .findMany({
        where: {
          tenancyId: tenancy.id,
          signUpAt: {
            gte: windowStart,
          },
          signUpEmailBase: heuristicFacts.signUpEmailBase,
          AND: [
            {
              signUpEmailNormalized: {
                not: null,
              },
            },
            {
              signUpEmailNormalized: {
                not: heuristicFacts.signUpEmailNormalized,
              },
            },
          ],
        },
        select: {
          projectUserId: true,
        },
        take: similarEmailMinimumMatches,
      })
      .then((rows) => rows.length);

  const [sameIpRecentCount, similarEmailRecentCount] = await Promise.all([
    sameIpPromise,
    similarEmailPromise,
  ]);

  return {
    sameIpRecentCount,
    similarEmailRecentCount,
  };
}

export async function calculateSignUpRiskAssessment(
  tenancy: Tenancy,
  context: SignUpRiskScoreContext,
): Promise<SignUpRiskAssessment> {
  const heuristicFacts = deriveSignUpHeuristicFacts({
    primaryEmail: context.primaryEmail,
    ipAddress: context.ipAddress,
    ipTrusted: context.ipTrusted,
  });
  const recentSignUpStats = await loadRecentSignUpStats(tenancy, heuristicFacts);
  const emailableResult: EmailableCheckResult = context.primaryEmail == null
    ? { status: "ok", emailableScore: null }
    : await checkEmailWithEmailable(context.primaryEmail);

  const recentSameIpMatched = heuristicFacts.signUpIp != null && recentSignUpStats.sameIpRecentCount >= sameIpMinimumMatches;
  const similarEmailMatched = heuristicFacts.signUpEmailBase != null
    && heuristicFacts.signUpEmailNormalized != null
    && recentSignUpStats.similarEmailRecentCount >= similarEmailMinimumMatches;

  const disposableContribution = getDisposableEmailContribution(emailableResult);

  const sameIpContribution = recentSameIpMatched ? getRecentSameIpWeights(context.ipTrusted) : {
    bot: 0,
    free_trial_abuse: 0,
  };

  const similarEmailContribution = similarEmailMatched ? {
    bot: similarEmailWeights.bot,
    free_trial_abuse: similarEmailWeights.free_trial_abuse,
  } : {
    bot: 0,
    free_trial_abuse: 0,
  };

  const turnstileContribution = getTurnstileWeights(context.turnstileAssessment);

  const scores = {
    bot: clampRiskScore(
      disposableContribution.bot
      + sameIpContribution.bot
      + similarEmailContribution.bot
      + turnstileContribution.bot,
    ),
    free_trial_abuse: clampRiskScore(
      disposableContribution.free_trial_abuse
      + sameIpContribution.free_trial_abuse
      + similarEmailContribution.free_trial_abuse
      + turnstileContribution.free_trial_abuse,
    ),
  };

  return {
    scores,
    heuristicFacts,
  };
}

export async function calculateSignUpRiskScores(tenancy: Tenancy, context: SignUpRiskScoreContext): Promise<SignUpRiskScores> {
  return (await calculateSignUpRiskAssessment(tenancy, context)).scores;
}

import.meta.vitest?.test("getRecentSameIpWeights(...)", ({ expect }) => {
  expect(getRecentSameIpWeights(true)).toEqual({
    bot: trustedSameIpWeights.bot,
    free_trial_abuse: trustedSameIpWeights.free_trial_abuse,
  });
  expect(getRecentSameIpWeights(false)).toEqual({
    bot: spoofableSameIpWeights.bot,
    free_trial_abuse: spoofableSameIpWeights.free_trial_abuse,
  });
});

import.meta.vitest?.test("getTurnstileWeights(...)", ({ expect }) => {
  expect(getTurnstileWeights({ status: "ok" })).toEqual({
    bot: 0,
    free_trial_abuse: 0,
  });
  expect(getTurnstileWeights({ status: "error" })).toEqual({
    bot: 0,
    free_trial_abuse: 0,
  });
  expect(getTurnstileWeights({ status: "invalid" })).toEqual({
    bot: turnstileFailedWeights.bot,
    free_trial_abuse: turnstileFailedWeights.free_trial_abuse,
  });
  expect(getTurnstileWeights({ status: "invalid", visibleChallengeResult: "ok" })).toEqual({
    bot: turnstileRecoveredWeights.bot,
    free_trial_abuse: turnstileRecoveredWeights.free_trial_abuse,
  });
});

import.meta.vitest?.test("getDisposableEmailContribution(...)", ({ expect }) => {
  expect(getDisposableEmailContribution({
    status: "error",
    error: new Error("Emailable unavailable"),
    emailableScore: null,
  })).toEqual({
    bot: 0,
    free_trial_abuse: 0,
  });

  expect(getDisposableEmailContribution({
    status: "not-deliverable",
    emailableResponse: {
      state: "undeliverable",
      disposable: false,
      score: null,
    },
    emailableScore: null,
  })).toEqual({
    bot: disposableEmailWeights.bot,
    free_trial_abuse: disposableEmailWeights.free_trial_abuse,
  });
});
