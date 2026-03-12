import { getPrismaClientForTenancy } from "@/prisma-client";
import type { SignUpRiskScoresCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { checkEmailWithEmailable } from "./emailable";
import { Tenancy } from "./tenancies";
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
  authMethod: 'password' | 'otp' | 'oauth' | 'passkey',
  oauthProvider: string | null,
  ipAddress: string | null,
  ipTrusted: boolean | null,
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

type RecentSignUpStats = {
  sameIpRecentCount: number,
  similarEmailRecentCount: number,
};

async function loadRecentSignUpStats(
  tenancy: Tenancy,
  heuristicFacts: DerivedSignUpHeuristicFacts,
): Promise<RecentSignUpStats> {
  const prisma = await getPrismaClientForTenancy(tenancy);
  const windowStart = new Date(heuristicFacts.signUpHeuristicRecordedAt.getTime() - recentWindowHours * 60 * 60 * 1000);

  const sameIpPromise = heuristicFacts.signUpIp == null
    ? Promise.resolve(0)
    : prisma.projectUser
      .findMany({
        where: {
          tenancyId: tenancy.id,
          signUpHeuristicRecordedAt: {
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
          signUpHeuristicRecordedAt: {
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
  const emailableResult = context.primaryEmail == null
    ? { status: "ok" } as const
    : await checkEmailWithEmailable(context.primaryEmail);

  const disposableEmailMatched = emailableResult.status === "not-deliverable" || emailableResult.status === "error";
  const recentSameIpMatched = heuristicFacts.signUpIp != null && recentSignUpStats.sameIpRecentCount >= sameIpMinimumMatches;
  const similarEmailMatched = heuristicFacts.signUpEmailBase != null
    && heuristicFacts.signUpEmailNormalized != null
    && recentSignUpStats.similarEmailRecentCount >= similarEmailMinimumMatches;

  const disposableContribution = disposableEmailMatched ? {
    bot: disposableEmailWeights.bot,
    free_trial_abuse: disposableEmailWeights.free_trial_abuse,
  } : {
    bot: 0,
    free_trial_abuse: 0,
  };

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

  const scores = {
    bot: clampRiskScore(
      disposableContribution.bot
      + sameIpContribution.bot
      + similarEmailContribution.bot,
    ),
    free_trial_abuse: clampRiskScore(
      disposableContribution.free_trial_abuse
      + sameIpContribution.free_trial_abuse
      + similarEmailContribution.free_trial_abuse,
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
