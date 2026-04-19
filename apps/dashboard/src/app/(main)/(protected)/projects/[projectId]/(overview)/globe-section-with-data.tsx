'use client';

import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
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

  return <GlobeSection countryData={data.users_by_country} totalUsers={data.total_users} />;
}
