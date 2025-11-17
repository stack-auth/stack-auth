'use client';

import { AppSquare, appSquarePaddingExpression, appSquareWidthExpression } from "@/components/app-square";
import { Link } from "@/components/link";
import { ALL_APPS, AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { cn } from '@stackframe/stack-ui';
import { ArrowRight } from "lucide-react";
import { Suspense, useState } from 'react';
import { PageLayout } from "../page-layout";
import { useAdminApp } from '../use-admin-app';
import { ChartsSectionWithData } from './charts-section-with-data';
import { GlobeSectionWithData } from './globe-section-with-data';
import { MetricsLoadingFallback } from './metrics-loading';


export default function MetricsPage(props: { toSetup: () => void }) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const [includeAnonymous, setIncludeAnonymous] = useState(false);

  const installedApps = Object.entries(config.apps.installed)
    .filter(([_, appConfig]) => appConfig?.enabled)
    .map(([appId]) => appId as AppId);

  const suggestedApps = typedEntries(ALL_APPS)
    .filter(([_, app]) => app.stage === "stable")
    .map(([appId]) => appId)
    .filter((appId) => !config.apps.installed[appId]?.enabled);

  return (
    <PageLayout>
      <Suspense fallback={<MetricsLoadingFallback />}>
        <GlobeSectionWithData includeAnonymous={includeAnonymous} />
      </Suspense>


      {/* Apps */}
      <section className="mb-8">
        <div
          className="grid gap-y-1 gap-x-1.5 justify-items-between"
          style={{
            gridTemplateColumns: `repeat(auto-fit,minmax(${appSquareWidthExpression},1fr))`,
          }}
        >
          <h2 className="text-xl font-bold col-span-full mb-4">Installed Apps</h2>
          {installedApps.length > 0 ? (
            installedApps.map(appId => (
              <AppSquare key={appId} appId={appId} />
            ))
          ) : (
            <p className="text-gray-500 dark:text-gray-400 col-span-full">No apps installed yet.</p>
          )}

          <h2 className="text-xl font-bold col-span-full mb-4 mt-4">Suggested Apps</h2>
          {suggestedApps.length > 0 ? (<>
            {suggestedApps.map(appId => (
              <AppSquare key={appId} appId={appId} />
            ))}
            <div className="flex flex-col items-center">
              <Link
                href={urlString`/projects/${adminApp.projectId}/apps`}
                className={cn(
                "flex-grow flex flex-col items-center gap-1 sm:gap-2 transition-all duration-200 cursor-pointer group select-none",
                "p-2 rounded-lg",
                "hover:bg-foreground/15 hover:duration-0",
              )}
                style={{
                  padding: appSquarePaddingExpression,
                  width: appSquareWidthExpression,
                }}
              >
                <div className="flex-grow" />
                <ArrowRight className="w-16 h-16 text-gray-400" strokeWidth={1.5} />
                <div className="flex-grow" />
                <span className="text-xs lg:text-sm text-gray-600 dark:text-gray-400">Explore more</span>
              </Link>
            </div>
          </>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 col-span-full">No app suggestions.</p>
          )}
        </div>
      </section>

      {/* Charts */}
      <Suspense fallback={<MetricsLoadingFallback />}>
        <ChartsSectionWithData includeAnonymous={includeAnonymous} />
      </Suspense>
    </PageLayout>
  );
}
