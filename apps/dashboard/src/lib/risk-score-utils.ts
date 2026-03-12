export const RISK_SCORE_REGEX = /^(100|[1-9]?[0-9])$/;

export function validateRiskScore(value: string | null | undefined): boolean {
  return value == null || value === "" || RISK_SCORE_REGEX.test(value);
}

export function parseRiskScore(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("Risk scores must be integers between 0 and 100");
  }
  return parsed;
}
