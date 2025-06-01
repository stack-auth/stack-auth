'use client';

import { useRouter } from "@/components/router";
import { ErrorBoundary } from '@sentry/nextjs';
import { UserAvatar } from '@stackframe/stack';
import { fromNow } from '@stackframe/stack-shared/dist/utils/dates';
import { Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableRow, Typography } from '@stackframe/stack-ui';
import { PageLayout } from "../../page-layout";
import { useAdminApp } from '../../use-admin-app';
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
  const router = useRouter();

  const data = (adminApp as any)[stackAppInternalsSymbol].useMetrics();

  return (
    <PageLayout fillWidth>
      <ErrorBoundary fallback={<div className='text-center text-sm text-red-500'>Error initializing globe visualization. Please try updating your browser or enabling WebGL.</div>}>
        <GlobeSection countryData={data.users_by_country} totalUsers={data.total_users} />
      </ErrorBoundary>
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
