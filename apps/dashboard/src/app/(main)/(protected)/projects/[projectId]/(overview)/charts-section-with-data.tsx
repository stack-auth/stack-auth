'use client';

import { useRouter } from "@/components/router";
import { UserAvatar } from '@stackframe/stack';
import { fromNow } from '@stackframe/stack-shared/dist/utils/dates';
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
        />
        <LineChartDisplay
          config={dauConfig}
          datapoints={data.daily_active_users}
        />
      </div>

      {/* Activity Grid */}
      <div className='grid gap-4 lg:grid-cols-3'>
        {/* Recent Sign Ups - 2/3 width */}
        <div className="lg:col-span-2 relative overflow-hidden rounded-xl border border-border bg-card transition-all hover:shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 hover:opacity-100 transition-opacity" />
          <div className="relative p-5">
            <h3 className="text-base font-semibold mb-4">Recent Sign Ups</h3>
            {data.recently_registered.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-muted-foreground">No recent sign ups</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.recently_registered.map((user: any) => (
                  <div
                    key={user.id}
                    onClick={() => router.push(`/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(user.id)}`)}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-accent cursor-pointer transition-colors group"
                  >
                    <UserAvatar
                      user={{
                        profileImageUrl: user.profile_image_url,
                        displayName: user.display_name,
                        primaryEmail: user.primary_email
                      }}
                      size={40}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {user.display_name ?? user.primary_email}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fromNow(new Date(user.signed_up_at_millis))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Auth Methods Donut */}
        <DonutChartDisplay
          datapoints={data.login_methods}
        />
      </div>

      {/* Recently Active - Full Width Grid */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-card transition-all hover:shadow-lg">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 hover:opacity-100 transition-opacity" />
        <div className="relative p-5">
          <h3 className="text-base font-semibold mb-4">Recently Active</h3>
          {data.recently_active.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">No recent activity</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {data.recently_active.map((user: any) => (
                <div
                  key={user.id}
                  onClick={() => router.push(`/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(user.id)}`)}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-accent cursor-pointer transition-colors group"
                >
                  <UserAvatar
                    user={{
                      profileImageUrl: user.profile_image_url,
                      displayName: user.display_name,
                      primaryEmail: user.primary_email
                    }}
                    size={40}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {user.display_name ?? user.primary_email}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {fromNow(new Date(user.last_active_at_millis))}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
