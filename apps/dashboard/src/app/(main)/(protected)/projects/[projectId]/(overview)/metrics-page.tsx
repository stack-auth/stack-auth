'use client';

import { AppSquare, appSquarePaddingExpression, appSquareWidthExpression } from "@/components/app-square";
import { Link } from "@/components/link";
import { useRouter } from "@/components/router";
import { ErrorBoundary } from '@sentry/nextjs';
import { UserAvatar } from '@stackframe/stack';
import { ALL_APPS, AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { fromNow } from '@stackframe/stack-shared/dist/utils/dates';
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableRow, Typography, cn } from '@stackframe/stack-ui';
import { ArrowRight } from "lucide-react";
import { useState } from 'react';
import { PageLayout } from "../page-layout";
import { useAdminApp } from '../use-admin-app';
import { GlobeSection } from './globe';
import { DonutChartDisplay, LineChartDisplay, LineChartDisplayConfig } from './line-chart';


const stackAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");

const dailySignUpsConfig = {
  name: 'Daily Sign-ups',
  description: 'User registration over the last 30 days',
  chart: {
    activity: {
      label: "Activity",
      color: "#cc6ce7",
    },
  }
} satisfies LineChartDisplayConfig;

const dauConfig = {
  name: 'Daily Active Users',
  description: 'Number of unique users that were active over the last 30 days',
  chart: {
    activity: {
      label: "Activity",
      color: "#2563eb",
    },
  }
} satisfies LineChartDisplayConfig;

export default function MetricsPage(props: { toSetup: () => void }) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const router = useRouter();
  const [includeAnonymous, setIncludeAnonymous] = useState(false);

  const data = (adminApp as any)[stackAppInternalsSymbol].useMetrics(includeAnonymous);
  //
  const installedApps = Object.entries(config.apps.installed)
    .filter(([_, appConfig]) => appConfig?.enabled)
    .map(([appId]) => appId as AppId);

  const suggestedApps = typedEntries(ALL_APPS)
    .filter(([_, app]) => app.stage === "stable")
    .map(([appId]) => appId)
    .filter((appId) => !config.apps.installed[appId]?.enabled);

  return (
    <PageLayout>
      <ErrorBoundary fallback={<div className='text-center text-sm text-red-500'>Error initializing globe visualization. Please try updating your browser or enabling WebGL.</div>}>
        <GlobeSection countryData={data.users_by_country} totalUsers={data.total_users} />
      </ErrorBoundary>


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

      <div className='grid gap-4 lg:grid-cols-2'>
        <LineChartDisplay
          config={dailySignUpsConfig}
          datapoints={data.daily_users}
        />
        <LineChartDisplay
          config={dauConfig}
          datapoints={data.daily_active_users}
        />
        <Card>
          <CardHeader>
            <CardTitle>Recent Sign Ups</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recently_registered.length === 0 && (
              <Typography variant='secondary'>No recent sign ups</Typography>
            )}
            <Table>
              <TableBody>
                {data.recently_registered.map((user: any) => (
                  <TableRow
                    key={user.id}
                    onClick={() => router.push(`/projects/${encodeURIComponent(adminApp.projectId)}/users/${encodeURIComponent(user.id)}`)}
                  >
                    <TableCell className='w-10 h-10'>
                      <UserAvatar user={{ profileImageUrl: user.profile_image_url, displayName: user.display_name, primaryEmail: user.primary_email }} />
                    </TableCell>
                    <TableCell>
                      {user.display_name ?? user.primary_email}
                      <Typography variant='secondary'>
                        signed up {fromNow(new Date(user.signed_up_at_millis))}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recently Active Users</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recently_active.length === 0 && (
              <Typography variant='secondary'>No recent active users</Typography>
            )}
            <Table>
              <TableBody>
                {data.recently_active.map((user: any) => (
                  <TableRow
                    key={user.id}
                    onClick={() => router.push(`/projects/${encodeURIComponent(adminApp.projectId)}/users/${encodeURIComponent(user.id)}`)}
                  >
                    <TableCell className='w-10 h-10'>
                      <UserAvatar user={{ profileImageUrl: user.profile_image_url, displayName: user.display_name, primaryEmail: user.primary_email }} />
                    </TableCell>
                    <TableCell>
                      {user.display_name ?? user.primary_email}
                      <Typography variant='secondary'>
                        last active {fromNow(new Date(user.last_active_at_millis))}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <DonutChartDisplay
          datapoints={data.login_methods}
        />
      </div>
    </PageLayout>
  );
}
