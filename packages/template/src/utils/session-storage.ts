/**
 * Guarded sessionStorage access for resilience layers (redirect loop breaking, redirect-back state
 * mirroring). These layers must degrade to "no stored value" when storage is unavailable, instead
 * of breaking the auth flow they are trying to protect.
 */

export function readSessionStorageItem(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // Storage can be blocked entirely (private browsing, sandboxed iframes, disabled cookies), in
    // which case accessing window.sessionStorage throws. Treat that as "nothing stored".
    return null;
  }
}

export function writeSessionStorageItem(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage can be blocked or full; see readSessionStorageItem. Values written here are only
    // used as a fallback, so failing to persist must not fail the caller.
  }
}

export function removeSessionStorageItem(key: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // See readSessionStorageItem.
  }
}
