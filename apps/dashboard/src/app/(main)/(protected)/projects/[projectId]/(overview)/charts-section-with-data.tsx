'use client';

import { useRouter } from "@/components/router";
import { UserAvatar } from '@stackframe/stack';
import { fromNow } from '@stackframe/stack-shared/dist/utils/dates';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Typography,
} from "@stackframe/stack-ui";
import { useAdminApp, useProjectId } from '../use-admin-app';
import { DonutChartDisplay, LineChartDisplay, LineChartDisplayConfig } from './line-chart';

const stackAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");

const dailySignUpsConfig = {
  name: 'Daily Sign-ups',
  description: 'User registration over the last 30 days',
  chart: {
    activity: {
      label: "Activity",
      theme: {
        light: "hsl(221, 83%, 53%)", // Bright blue for light mode
        dark: "hsl(217, 91%, 60%)",  // Lighter blue for dark mode
      },
    },
  }
} satisfies LineChartDisplayConfig;

const dauConfig = {
  name: 'Daily Active Users',
  description: 'Number of unique users that were active over the last 30 days',
  chart: {
    activity: {
      label: "Activity",
      theme: {
        light: "hsl(142, 76%, 36%)", // Bright green for light mode
        dark: "hsl(142, 71%, 45%)", // Lighter green for dark mode
      },
    },
  }
} satisfies LineChartDisplayConfig;

export function ChartsSectionWithData({ includeAnonymous }: { includeAnonymous: boolean }) {
  const adminApp = useAdminApp();
  const projectId = useProjectId();
  const router = useRouter();
  const data = (adminApp as any)[stackAppInternalsSymbol].useMetrics(includeAnonymous);

  return (
    <div className='flex flex-col gap-4'>
      {/* Charts Grid */}
      <div className='grid gap-4 lg:grid-cols-2'>
        <LineChartDisplay
          config={dailySignUpsConfig}
          datapoints={data.daily_users}
          timeRange="30d"
        />
        <LineChartDisplay
          config={dauConfig}
          datapoints={data.daily_active_users}
          timeRange="30d"
        />
      </div>

      {/* Activity Grid */}
      <div className='grid gap-4 lg:grid-cols-3'>
        {/* Recent Sign Ups - 2/3 width */}
        <Card className="lg:col-span-2 transition-all">
          <CardHeader className="pb-3">
            <div className="space-y-1">
              <Typography className="text-xs font-medium uppercase tracking-wide text-blue-700">
                Activity
              </Typography>
              <CardTitle className="text-base font-semibold">
                Recent Sign Ups
              </CardTitle>
              <CardDescription className="text-xs">
                Users who signed up most recently.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {data.recently_registered.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Typography variant="secondary" className="text-sm">
                  No recent sign ups
                </Typography>
              </div>
            ) : (
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {data.recently_registered.map((user: any) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() =>
                      router.push(
                        `/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(user.id)}`
                      )
                    }
                    className="flex w-full items-center gap-3 rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                  >
                    <UserAvatar
                      user={{
                        profileImageUrl: user.profile_image_url,
                        displayName: user.display_name,
                        primaryEmail: user.primary_email,
                      }}
                      size={40}
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <Typography className="truncate text-sm font-medium leading-snug">
                        {user.display_name ?? user.primary_email}
                      </Typography>
                      <Typography variant="secondary" className="text-xs">
                        {fromNow(new Date(user.signed_up_at_millis))}
                      </Typography>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Auth Methods Donut */}
        <DonutChartDisplay
          datapoints={data.login_methods}
        />
      </div>

      {/* Recently Active - Full Width Grid */}
      <Card className="transition-all">
        <CardHeader className="pb-3">
          <div className="space-y-1">
            <Typography className="text-xs font-medium uppercase tracking-wide text-blue-700">
              Activity
            </Typography>
            <CardTitle className="text-base font-semibold">
              Recently Active
            </CardTitle>
            <CardDescription className="text-xs">
              Users who were active most recently.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {data.recently_active.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Typography variant="secondary" className="text-sm">
                No recent activity
              </Typography>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              {data.recently_active.map((user: any) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() =>
                    router.push(
                      `/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(user.id)}`
                    )
                  }
                  className="flex w-full items-center gap-3 rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                >
                  <UserAvatar
                    user={{
                      profileImageUrl: user.profile_image_url,
                      displayName: user.display_name,
                      primaryEmail: user.primary_email,
                    }}
                    size={40}
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <Typography className="truncate text-sm font-medium leading-snug">
                      {user.display_name ?? user.primary_email}
                    </Typography>
                    <Typography variant="secondary" className="text-xs truncate">
                      {fromNow(new Date(user.last_active_at_millis))}
                    </Typography>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
