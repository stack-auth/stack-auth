"use client";

import { useEffect, useSyncExternalStore } from "react";

// Once hydrated, the indicator is driven by the number of mounted SiteLoadingIndicator
// components instead of by the mere presence of their marker element in the DOM. React/Next
// keeps the previous route mounted in a hidden subtree (inline `display: none !important`)
// after a navigation, and if that route was still showing its Suspense fallback, the
// fallback's marker lingers there forever — which used to keep the indicator visible
// forever, too. Effects of hidden subtrees are cleaned up, so the count doesn't have that
// problem. The marker element remains for the pre-hydration/no-JS path (see globals.css).
const subscribers = new Set<() => void>();
let indicatorCount = 0;

function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
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
      data-site-loading-indicator={count === null ? undefined : (count > 0 ? "active" : "inactive")}
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
