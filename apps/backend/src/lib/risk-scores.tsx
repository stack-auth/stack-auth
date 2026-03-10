import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Tenancy } from "./tenancies";

export type SignUpRiskScores = {
  bot: number,
  freeTrialAbuse: number,
};

export type SignUpRiskScoreContext = {
  primaryEmail: string | null,
  primaryEmailVerified: boolean,
  authMethod: 'password' | 'otp' | 'oauth' | 'passkey',
  oauthProvider: string | null,
  ipAddress: string | null,
};

type SignUpRiskHeuristic = {
  id: string,
  weight: number,
  matches: (context: SignUpRiskScoreContext) => boolean,
};

const disposableEmailDomainPatterns = [
  /(?:^|[-.])(?:10|20)minute(?:s)?mail(?:$|[-.])/,
  /(?:^|[-.])temp(?:[-.]?(?:mail|ail)|mailo|mailninja)(?:$|[-.])/,
  /(?:^|[-.])throwaway(?:$|[-.])/,
  /(?:^|[-.])guerrilla(?:[-.]?mail)?(?:$|[-.])/,
  /(?:^|[-.])mailinator(?:$|[-.])/,
  /(?:^|[-.])yopmail(?:$|[-.])/,
  /(?:^|[-.])trashmail(?:$|[-.])/,
  /(?:^|[-.])dropmail(?:$|[-.])/,
  /(?:^|[-.])mailnesia(?:$|[-.])/,
  /(?:^|[-.])getnada(?:$|[-.])/,
  /(?:^|[-.])emailnator(?:$|[-.])/,
  /(?:^|[-.])emailondeck(?:$|[-.])/,
  /(?:^|[-.])emailtemporanea(?:$|[-.])/,
  /(?:^|[-.])fakeinbox(?:$|[-.])/,
  /(?:^|[-.])mintemail(?:$|[-.])/,
  /(?:^|[-.])sharklasers(?:$|[-.])/,
  /(?:^|[-.])dispostable(?:$|[-.])/,
  /(?:^|[-.])moakt(?:$|[-.])/,
  /(?:^|[-.])tmpmail(?:$|[-.])/,
] as const;

const botRiskHeuristics: readonly SignUpRiskHeuristic[] = [
  {
    id: "disposable-email-domain",
    weight: 100,
    matches: (context) => disposableEmailDomainPatterns.some((pattern) => pattern.test(normalizeEmailDomain(context.primaryEmail))),
  },
] as const;

const freeTrialAbuseRiskHeuristics: readonly SignUpRiskHeuristic[] = [
  {
    id: "disposable-email-domain",
    weight: 100,
    matches: (context) => disposableEmailDomainPatterns.some((pattern) => pattern.test(normalizeEmailDomain(context.primaryEmail))),
  },
] as const;

function normalizeEmailDomain(primaryEmail: string | null): string {
  if (primaryEmail == null) {
    return "";
  }

  const [, emailDomain = ""] = primaryEmail.trim().toLowerCase().split("@");
  return emailDomain.replace(/\.+$/, "");
}

function calculateWeightedRiskScore(
  heuristics: readonly SignUpRiskHeuristic[],
  context: SignUpRiskScoreContext,
): number {
  const maxScore = heuristics.reduce((sum, heuristic) => sum + heuristic.weight, 0);
  if (maxScore !== 100) {
    throw new StackAssertionError(`Sign-up risk heuristic weights must sum to 100, received ${maxScore}`);
  }

  return heuristics.reduce((sum, heuristic) => {
    return heuristic.matches(context) ? sum + heuristic.weight : sum;
  }, 0);
}

function calculateDisposableEmailHeuristicScores(context: SignUpRiskScoreContext): SignUpRiskScores {
  return {
    bot: calculateWeightedRiskScore(botRiskHeuristics, context),
    freeTrialAbuse: calculateWeightedRiskScore(freeTrialAbuseRiskHeuristics, context),
  };
}

export async function calculateSignUpRiskScores(_tenancy: Tenancy, context: SignUpRiskScoreContext): Promise<SignUpRiskScores> {
  return calculateDisposableEmailHeuristicScores(context);
}

import.meta.vitest?.test("calculateDisposableEmailHeuristicScores(...)", ({ expect }) => {
  expect(calculateDisposableEmailHeuristicScores({
    primaryEmail: "user@tempmail.com",
    primaryEmailVerified: false,
    authMethod: "password",
    oauthProvider: null,
    ipAddress: null,
  })).toEqual({
    bot: 100,
    freeTrialAbuse: 100,
  });

  expect(calculateDisposableEmailHeuristicScores({
    primaryEmail: "user@best-tempmail-service.com",
    primaryEmailVerified: false,
    authMethod: "password",
    oauthProvider: null,
    ipAddress: null,
  })).toEqual({
    bot: 100,
    freeTrialAbuse: 100,
  });

  expect(calculateDisposableEmailHeuristicScores({
    primaryEmail: "user@example.com",
    primaryEmailVerified: false,
    authMethod: "password",
    oauthProvider: null,
    ipAddress: null,
  })).toEqual({
    bot: 0,
    freeTrialAbuse: 0,
  });
});
