import { useMemo, useSyncExternalStore } from "react";

function getReferrerSnapshot(): string {
  if (typeof document === "undefined") return "";
  return document.referrer;
}

function subscribeToReferrer() {
  // document.referrer never changes after page load, so no-op subscription
  return () => {};
}

function useExternalBackUrl(): string | null {
  const referrer = useSyncExternalStore(subscribeToReferrer, getReferrerSnapshot, () => "");
  return useMemo(() => {
    if (!referrer || !URL.canParse(referrer)) return null;
    const parsed = new URL(referrer);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.origin === window.location.origin) return null;
    return referrer;
  }, [referrer]);
}

export function useHostedBackUrl(explicitBackUrl?: string | null): string {
  const externalBackUrl = useExternalBackUrl();
  if (explicitBackUrl) {
    return explicitBackUrl;
  }
  return externalBackUrl ?? "/";
}
