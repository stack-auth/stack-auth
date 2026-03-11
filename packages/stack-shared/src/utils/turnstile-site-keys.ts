import { turnstileDevelopmentKeys } from "./turnstile";

function isDevelopmentLikeEnvironment() {
  try {
    return (globalThis as any).process?.env?.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

export function resolveTurnstileSiteKey(
  configuredKey: string | undefined,
  envKey: string | undefined,
): string | undefined {
  const key = configuredKey ?? envKey;
  if (key != null) return key;
  if (isDevelopmentLikeEnvironment()) {
    return turnstileDevelopmentKeys.visibleSiteKey;
  }
  return undefined;
}

export function resolveTurnstileInvisibleSiteKey(
  configuredInvisibleKey: string | undefined,
  envInvisibleKey: string | undefined,
  fallbackVisibleKey?: string,
): string | undefined {
  const key = configuredInvisibleKey ?? envInvisibleKey;
  if (key != null) return key;
  if (isDevelopmentLikeEnvironment()) {
    return turnstileDevelopmentKeys.invisibleSiteKey;
  }
  return fallbackVisibleKey;
}
