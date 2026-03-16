export const RISK_SCORE_REGEX = /^(100|[1-9]?[0-9])$/;

export function validateRiskScore(value: string | null | undefined): boolean {
  return value == null || value === "" || RISK_SCORE_REGEX.test(value);
}

export function parseRiskScore(value: string): number {
  if (!RISK_SCORE_REGEX.test(value)) {
    throw new Error("Risk scores must be integers between 0 and 100");
  }
  return Number(value);
}
