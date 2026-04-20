'use client';

import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { cn } from "@/lib/utils";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { ErrorBoundary } from "next/dist/client/components/error-boundary";
import { useAdminApp } from '../use-admin-app';
import { GlobeSection } from './globe';

const capturedGlobeErrors = new WeakSet<Error>();

function captureGlobeErrorOnce(error: Error) {
  if (capturedGlobeErrors.has(error)) {
    return;
  }
  capturedGlobeErrors.add(error);
  captureError("metrics-globe-error-boundary", error);
}

export function GlobeSectionWithData({ includeAnonymous }: { includeAnonymous: boolean }) {
  return (
    <ErrorBoundary errorComponent={GlobeErrorComponent}>
      <GlobeSectionWithMetrics includeAnonymous={includeAnonymous} />
    </ErrorBoundary>
  );
}

function GlobeErrorComponent(props: { error: Error }) {
  captureGlobeErrorOnce(props.error);
  return <div className='text-center text-sm text-red-500'>Error initializing globe visualization. Please try updating your browser or enabling WebGL.</div>;
}

function GlobeSectionWithMetrics({ includeAnonymous }: { includeAnonymous: boolean }) {
  const adminApp = useAdminApp();
  const data = (adminApp as any)[stackAppInternalsSymbol].useMetrics(includeAnonymous);

  return (
    <>
      <LiveUsersBadge count={data.live_users ?? 0} />
      <GlobeSection
        countryData={data.users_by_country}
        totalUsers={data.total_users}
        activeUsersByCountry={data.active_users_by_country ?? {}}
      />
    </>
  );
}

// "Who is online right now" pill rendered over the globe. Sourced from
// `metrics.live_users` — distinct users with a `$token-refresh` event in the
// last ~2 minutes — so the number matches the green avatar ping layer that
// `GlobeSection` draws from `active_users_by_country`.
function LiveUsersBadge({ count }: { count: number }) {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const isLive = safeCount > 0;
  return (
    <div
      className="absolute top-0 right-0 z-10 px-5 pt-4 dark:px-1 dark:pt-0 pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 backdrop-blur-sm",
          isLive
            ? "bg-emerald-500/10 ring-emerald-500/20 dark:bg-emerald-500/15 dark:ring-emerald-500/25"
            : "bg-foreground/[0.04] ring-foreground/[0.08]",
        )}
      >
        <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
          {isLive && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
          )}
          <span
            className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
              isLive ? "bg-emerald-500" : "bg-muted-foreground/60",
            )}
          />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {isLive ? "Live" : "Idle"}
        </span>
        <span className="text-[11px] font-bold tabular-nums text-foreground leading-none">
          {safeCount.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
