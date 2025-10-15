import { getPublicEnvVar } from '@/lib/env';
import { runAsynchronously, wait } from "@stackframe/stack-shared/dist/utils/promises";
import packageJson from "../../package.json";

export type VersionCheckResult = {
  severe: boolean,
  error: string,
} | null;

export type VersionCheckOptions = {
  /** Delay before making the request (in milliseconds) */
  delay?: number,
  /** Whether to silently fail or throw errors */
  silentFailure?: boolean,
  /** Custom error message prefix for logging */
  errorPrefix?: string,
};

/**
 * Hook to check if non-severe version alerts should be shown
 * Based on NEXT_PUBLIC_VERSION_ALERTER_SEVERE_ONLY environment variable
 */
export function shouldShowNonSevereVersionCheck(): boolean {
  // IMPORTANT: THIS ENVIRONMENT VARIABLE IS UNDOCUMENTED AND NOT MEANT FOR PRODUCTION USAGE
  // AND YOU SHOULD ALWAYS KEEP STACK AUTH UP TO DATE. WE CAN'T APPLY SECURITY UPDATES IF
  // YOU DON'T UPDATE STACK AUTH REGULARLY.
  return getPublicEnvVar('NEXT_PUBLIC_VERSION_ALERTER_SEVERE_ONLY') !== "true";
}

/**
 * Utility to determine if a version check result should be displayed
 */
export function shouldDisplayVersionResult(
  result: VersionCheckResult,
  enableNonSevereCheck: boolean = shouldShowNonSevereVersionCheck()
): boolean {
  return result !== null && (enableNonSevereCheck || result.severe);
}

/**
 * Common utility function for checking version against Stack Auth API
 * Used by both VersionAlerter and StackCompanion components
 */
export function checkVersion(
  onResult: (result: VersionCheckResult) => void,
  options: VersionCheckOptions = {}
) {
  const {
    delay = 1000,
    silentFailure = false,
    errorPrefix = "Version check failed"
  } = options;

  // Skip check for managed hosting
  if (typeof window !== "undefined" && window.location.origin === "https://app.stack-auth.com") {
    return () => {}; // Return cleanup function
  }

  let cancelled = false;

  runAsynchronously(async () => {
    try {
      await wait(delay);
      if (cancelled) return;

      const res = await fetch(`https://api.stack-auth.com/api/v1/check-version`, {
        method: "POST",
        body: JSON.stringify({ clientVersion: packageJson.version }),
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (res.status !== 200) {
        if (silentFailure) {
          return; // Silently fail
        } else {
          throw new Error(`Version check API call failed with status ${res.status}: ${await res.text()}`);
        }
      }

      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (cancelled) return;

      onResult(data.upToDate ? null : data);
    } catch (e) {
      if (silentFailure) {
        console.warn(`${errorPrefix}:`, e);
        return;
      }

      // Wait a little bit because the error may have been caused by a page reload
      await wait(5000);
      if (cancelled) return;

      console.error(`${errorPrefix}`, e);
      onResult({
        severe: true,
        error: `Error checking version, please make sure you're connected to the internet. See the console for more details. \n${e}`
      });
    }
  });

  // Return cleanup function
  return () => {
    cancelled = true;
  };
}
