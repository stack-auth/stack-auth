// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  GLOBAL_ERROR_RECOVERY_ATTEMPTS_KEY,
  MAX_GLOBAL_ERROR_RECOVERY_ATTEMPTS,
  recordGlobalErrorRecoveryAttempt,
  resetGlobalErrorRecoveryAttempts,
} from "./global-error-recovery";

afterEach(() => {
  window.sessionStorage.clear();
});

describe("global error recovery", () => {
  it("stops retrying after the recovery limit", () => {
    expect(Array.from({ length: MAX_GLOBAL_ERROR_RECOVERY_ATTEMPTS }, () => recordGlobalErrorRecoveryAttempt())).toEqual([true, true]);
    expect(recordGlobalErrorRecoveryAttempt()).toBe(false);
    expect(window.sessionStorage.getItem(GLOBAL_ERROR_RECOVERY_ATTEMPTS_KEY)).toBe(String(MAX_GLOBAL_ERROR_RECOVERY_ATTEMPTS));
  });

  it("resets after a healthy render", () => {
    recordGlobalErrorRecoveryAttempt();
    resetGlobalErrorRecoveryAttempts();
    expect(recordGlobalErrorRecoveryAttempt()).toBe(true);
  });
});
