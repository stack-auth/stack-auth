'use client';

import { ErrorBoundary } from '@sentry/nextjs';
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { useAdminApp } from '../use-admin-app';
import { GlobeSection } from './globe';

export function GlobeSectionWithData({ includeAnonymous }: { includeAnonymous: boolean }) {
  const adminApp = useAdminApp();
  const data = (adminApp as any)[stackAppInternalsSymbol].useMetrics(includeAnonymous);

  return (
    <ErrorBoundary fallback={<div className='text-center text-sm text-red-500'>Error initializing globe visualization. Please try updating your browser or enabling WebGL.</div>}>
      <GlobeSection countryData={data.users_by_country} totalUsers={data.total_users} />
    </ErrorBoundary>
  );
}
