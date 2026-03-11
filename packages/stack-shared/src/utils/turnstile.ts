export const turnstileActionValues = [
  "sign_up_with_credential",
  "send_magic_link_email",
  "oauth_authenticate",
] as const;

export type TurnstileAction = typeof turnstileActionValues[number];

export const turnstilePhaseValues = [
  "invisible",
  "visible",
] as const;

export type TurnstilePhase = typeof turnstilePhaseValues[number];

export const turnstileResultValues = [
  "ok",
  "invalid",
  "error",
] as const;

export type TurnstileResult = typeof turnstileResultValues[number];

export const turnstileDevelopmentKeys = {
  visibleSiteKey: "1x00000000000000000000AA",
  invisibleSiteKey: "1x00000000000000000000BB",
  secretKey: "1x0000000000000000000000000000000AA",
  forcedChallengeSiteKey: "3x00000000000000000000FF",
} as const;

export const turnstileRetryResultValues = [
  "invalid",
  "error",
] as const;

export type TurnstileRetryResult = typeof turnstileRetryResultValues[number];

export function isTurnstileRetryResult(value: unknown): value is TurnstileRetryResult {
  return typeof value === "string" && turnstileRetryResultValues.some((status) => status === value);
}

export function isTurnstileResult(value: unknown): value is TurnstileResult {
  return typeof value === "string" && turnstileResultValues.some((status) => status === value);
}
