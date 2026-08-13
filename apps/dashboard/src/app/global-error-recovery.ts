export const GLOBAL_ERROR_RECOVERY_ATTEMPTS_KEY = "hexclave-global-error-recovery-attempts";
export const MAX_GLOBAL_ERROR_RECOVERY_ATTEMPTS = 2;

function getAttempts(): number {
  const value = window.sessionStorage.getItem(GLOBAL_ERROR_RECOVERY_ATTEMPTS_KEY);
  if (value === null) {
    return 0;
  }
  const attempts = Number(value);
  return Number.isInteger(attempts) && attempts >= 0 ? attempts : 0;
}

export function recordGlobalErrorRecoveryAttempt(): boolean {
  const attempts = getAttempts();
  if (attempts >= MAX_GLOBAL_ERROR_RECOVERY_ATTEMPTS) {
    return false;
  }
  window.sessionStorage.setItem(GLOBAL_ERROR_RECOVERY_ATTEMPTS_KEY, String(attempts + 1));
  return true;
}

export function resetGlobalErrorRecoveryAttempts(): void {
  window.sessionStorage.removeItem(GLOBAL_ERROR_RECOVERY_ATTEMPTS_KEY);
}
