import type { SignUpRiskScoresCrud } from "@stackframe/stack-shared/dist/interface/crud/users";

type ScorePair = Pick<SignUpRiskScoresCrud, "bot" | "free_trial_abuse">;

/**
 * Each signal's weight represents its budget — how many points (out of 100) it
 * can contribute at worst. The worst-case weights across all signals MUST sum
 * to exactly 100 per dimension, so every point in the final score maps directly
 * to a signal's contribution.
 *
 * For sameIp, the worst-case variant is "trusted" (higher confidence in the
 * signal → higher weight).
 */
export const riskScoreWeights = {
  emailable: { bot: 45, free_trial_abuse: 35 } satisfies ScorePair,
  sameIp: {
    trusted: { bot: 25, free_trial_abuse: 35 } satisfies ScorePair,
    spoofable: { bot: 12, free_trial_abuse: 18 } satisfies ScorePair,
  },
  similarEmail: { bot: 10, free_trial_abuse: 10 } satisfies ScorePair,
  turnstile: { bot: 20, free_trial_abuse: 20 } satisfies ScorePair,
} as const;

export const riskScoreThresholds = {
  recentWindowHours: 24,
  sameIpMinMatches: 1,
  sameIpMaxMatchesForFullPenalty: 3,
  similarEmailMinMatches: 1,
} as const;

// ── Invariant: worst-case weights must sum to exactly 100 ──────────────

const w = riskScoreWeights;
const worstCaseBot = w.emailable.bot + w.sameIp.trusted.bot + w.similarEmail.bot + w.turnstile.bot;
const worstCaseFta = w.emailable.free_trial_abuse + w.sameIp.trusted.free_trial_abuse + w.similarEmail.free_trial_abuse + w.turnstile.free_trial_abuse;

if (worstCaseBot !== 100) {
  throw new Error(`risk score weight invariant violated: worst-case bot weights sum to ${worstCaseBot}, expected 100`);
}
if (worstCaseFta !== 100) {
  throw new Error(`risk score weight invariant violated: worst-case free_trial_abuse weights sum to ${worstCaseFta}, expected 100`);
}
