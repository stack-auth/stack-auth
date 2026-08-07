"use client";

import { useEffect, useSyncExternalStore } from "react";

// The marker alone is not enough: React/Next can keep a previous route mounted in a
// hidden subtree, leaving its Suspense fallback marker behind indefinitely.
const subscribers = new Set<() => void>();
let indicatorCount = 0;

function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function getSnapshot() {
  return indicatorCount;
}

function getServerSnapshot() {
  return null;
}

function registerIndicator() {
  indicatorCount += 1;
  for (const subscriber of subscribers) {
    subscriber();
  }
  return () => {
    indicatorCount -= 1;
    for (const subscriber of subscribers) {
      subscriber();
    }
  };
}

export function SiteLoadingIndicatorDisplay() {
  const count = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Next.js doesn't like a sticky or fixed position element at the root, so wrap it in a span
  // https://github.com/shadcn-ui/ui/issues/1355
  return <span>
    <span
      className="site-loading-indicator"
      {...(count === null ? {} : { "data-site-loading-indicator": count > 0 ? "active" : "inactive" })}
    >
      <span className="site-loading-indicator-inner">
        <span className="site-loading-indicator-inner-glow" />
      </span>
    </span>
  </span>;
}

export function SiteLoadingIndicator() {
  useEffect(() => registerIndicator(), []);

  return <div className="show-site-loading-indicator" />;
}
