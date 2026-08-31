"use client";

import { AsyncCache } from "@hexclave/shared/dist/utils/caches";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { getGlobal, setGlobal } from "@hexclave/shared/dist/utils/globals";
import { deindent } from "@hexclave/shared/dist/utils/strings";
import { ErrorBoundary } from "next/dist/client/components/error-boundary";
import React, { Suspense, memo, useEffect } from "react";

let isPrefetchingCounter = 0;
let hasSetupHookPrefetcher = false;

export type HookPrefetcherCallback = () => HookPrefetcherCallback[] | void;

/**
 * Thrown by a prefetcher hook that cannot prefetch the resource it was pointed at — for example a
 * <Link> to a project the current dashboard user doesn't own (the Growth admin page links into the
 * customer projects it manages). Prefetching is best-effort, so this unwinds only the isolated
 * prefetch subtree below; the alternative, letting the hook call `notFound()`, escapes this
 * component's ErrorBoundary (Next resolves not-found digests at the route level) and would replace
 * the whole page the link merely sits on with a 404.
 */
export class PrefetchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrefetchUnavailableError";
  }
}

/**
 * Whether the calling hook is running inside a prefetch render rather than a render whose output the
 * user actually sees. Hooks that would otherwise navigate or hard-fail on missing data use this to
 * degrade into a PrefetchUnavailableError instead.
 */
export function isPrefetching(): boolean {
  return isPrefetchingCounter > 0;
}

// PrefetchMany is now defined outside of HookPrefetcher to maintain a stable component reference
const PrefetchMany = memo(function PrefetchMany(props: { callbacks: HookPrefetcherCallback[] }): React.ReactNode {
  return <>
    {props.callbacks.map((callback, i) => (
      <PrefetchCallback key={i} callback={callback} />
    ))}
  </>;
});

// Separate component for each callback to isolate renders
const PrefetchCallback = memo(function PrefetchCallback({ callback }: { callback: HookPrefetcherCallback }) {
  return (
    <ErrorBoundary errorComponent={HookPrefetcherErrorComponent}>
      <Suspense fallback={null}>
        <PrefetchCallbackInner callback={callback} />
      </Suspense>
    </ErrorBoundary>
  );
});

function PrefetchCallbackInner({ callback }: { callback: HookPrefetcherCallback }) {
  isPrefetchingCounter++;
  try {
    const componentCallbacks = callback();
    if (componentCallbacks) {
      return <PrefetchMany callbacks={componentCallbacks} />;
    }
    return null;
  } finally {
    isPrefetchingCounter--;
  }
}

export function HookPrefetcher(props: {
  callbacks: HookPrefetcherCallback[],
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (hasSetupHookPrefetcher) return;
    hasSetupHookPrefetcher = true;
    setGlobal("use-async-cache-execution-hooks", [
      ...(getGlobal("use-async-cache-execution-hooks") ?? []),
      (options: { caller: string, dependencies: any[], cache: AsyncCache<any, any> }) => {
        if (options.cache.isDirty(options.dependencies)) {
          if (isPrefetchingCounter > 0) {
            // all good, continue
            if (process.env.NODE_ENV === "development") {
              console.info(`Prefetching ${options.caller}...`);
            }
          } else {
            console.warn(deindent`
              Fetched ${options.caller} on ${window.location.pathname} without prefetching! Could you maybe add a HookPrefetcher to make this transition faster?
              
              To do this, if you used a <Link> to navigate to this page, you can add the hook to the \`urlPrefetchers\` in apps/dashboard/src/lib/prefetch/url-prefetcher.tsx. If you didn't use a <Link>, you can use the <HookPrefetcher> component to prefetch the data.
            `, options);
          }
        }
      },
    ]);
  }, []);

  return <PrefetchMany callbacks={props.callbacks} />;
}

function HookPrefetcherErrorComponent(props: { error: unknown }) {
  useEffect(() => {
    // An unprefetchable resource is an expected outcome, not a defect — don't report it.
    if (props.error instanceof PrefetchUnavailableError) return;
    captureError("hook-prefetcher", props.error);
  }, [props.error]);
  return null;
}
