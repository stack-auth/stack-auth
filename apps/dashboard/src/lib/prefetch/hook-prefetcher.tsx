"use client";

import { AsyncCache } from "@stackframe/stack-shared/dist/utils/caches";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { getGlobal, setGlobal } from "@stackframe/stack-shared/dist/utils/globals";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { ErrorBoundary } from "next/dist/client/components/error-boundary";
import { Suspense, useEffect } from "react";

let isPrefetching = false;
let hasSetupHookPrefetcher = false;

type HookPrefetcherCallback = () => void;

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
          if (isPrefetching) {
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

  const components = props.callbacks.map((callback, i) => () => {
    isPrefetching = true;
    try {
      callback();
      return null;
    } finally {
      isPrefetching = false;
    }
  } );

  return <>
    {components.map((Component, i) => (
      <ErrorBoundary
        key={i}
        errorComponent={HookPrefetcherErrorComponent}
      >
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </ErrorBoundary>
    ))}
  </>;
}

function HookPrefetcherErrorComponent(props: { error: Error }) {
  useEffect(() => {
    captureError("hook-prefetcher", props.error);
  }, [props.error]);
  return null;
}
