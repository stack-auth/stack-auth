export const turnstileActionValues = [
  "sign_up_with_credential",
  "send_magic_link_email",
  "oauth_authenticate",
] as const;

export type TurnstileAction = typeof turnstileActionValues[number];

export const turnstileResultValues = [
  "ok",
  "missing",
  "invalid",
  "error",
  "not_configured",
] as const;

export type TurnstileResult = typeof turnstileResultValues[number];

export function isTurnstileResult(value: unknown): value is TurnstileResult {
  return typeof value === "string" && turnstileResultValues.some((status) => status === value);
}

export function getTurnstileTestResult(token: string | null | undefined): TurnstileResult | null {
  if (token == null) {
    return null;
  }

  const trimmed = token.trim();
  if (!trimmed.startsWith("stack-turnstile-test:")) {
    return null;
  }

  const result = trimmed.slice("stack-turnstile-test:".length);
  return isTurnstileResult(result) ? result : null;
}

import.meta.vitest?.test("getTurnstileTestResult(...)", ({ expect }) => {
  expect(getTurnstileTestResult("stack-turnstile-test:ok")).toBe("ok");
  expect(getTurnstileTestResult("stack-turnstile-test:invalid")).toBe("invalid");
  expect(getTurnstileTestResult("stack-turnstile-test:error")).toBe("error");
  expect(getTurnstileTestResult("stack-turnstile-test:wat")).toBeNull();
  expect(getTurnstileTestResult("real-token")).toBeNull();
});
