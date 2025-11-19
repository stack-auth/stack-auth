'use client';

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { stackAppInternalsSymbol } from "@stackframe/stack";
import { Card, CardContent, CardHeader, CardTitle, SimpleTooltip, Typography, cn } from "@stackframe/stack-ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

type ActivityData = {
  activity: Array<{
    date: string,
    count: number,
  }>,
};

async function fetchUserActivity(adminApp: any, userId: string): Promise<ActivityData> {
  const response = await adminApp[stackAppInternalsSymbol].sendAdminRequest(`/internal/users/${encodeURIComponent(userId)}/activity`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user activity: ${response.statusText}`);
  }

  return response.json();
}

function getActivityLevel(count: number): number {
  if (count === 0) return 0;
  if (count <= 3) return 1;
  if (count <= 6) return 2;
  if (count <= 9) return 3;
  return 4;
}

type WeekData = {
  days: Array<{ date: string, count: number, dayOfWeek: number } | null>,
};

type MonthGroup = {
  month: string,
  weeks: WeekData[],
};

type ActivityGridData = {
  months: MonthGroup[],
};

function groupActivityByWeeks(activity: ActivityData['activity']): ActivityGridData {
  // Create a map for quick lookup
  const activityMap = new Map<string, number>();
  activity.forEach(day => {
    activityMap.set(day.date, day.count);
  });

  // Get date range (last 365 days)
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 364);

  // Start from the most recent Sunday
  const displayEndDate = new Date(endDate);
  while (displayEndDate.getDay() !== 0) {
    displayEndDate.setDate(displayEndDate.getDate() + 1);
  }

  // Go back to find start date (Sunday)
  const displayStartDate = new Date(displayEndDate);
  displayStartDate.setDate(displayStartDate.getDate() - 364);
  while (displayStartDate.getDay() !== 0) {
    displayStartDate.setDate(displayStartDate.getDate() - 1);
  }

  // Build weeks array
  const weeks: WeekData[] = [];
  const currentDate = new Date(displayStartDate);

  while (currentDate <= displayEndDate) {
    const week: WeekData = { days: [] };

    for (let i = 0; i < 7; i++) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const count = activityMap.get(dateStr) || 0;

      week.days.push({
        date: dateStr,
        count,
        dayOfWeek: currentDate.getDay(),
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    weeks.push(week);
  }

  // Group weeks by month (most recent first)
  const months: MonthGroup[] = [];
  const reversedWeeks = [...weeks].reverse();

  let currentMonth = '';
  let monthWeeks: WeekData[] = [];

  reversedWeeks.forEach((week) => {
    // Use the first day of the week to determine month
    const firstDay = week.days[0];
    if (firstDay) {
      const date = new Date(firstDay.date);
      const monthKey = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

      if (monthKey !== currentMonth) {
        if (currentMonth && monthWeeks.length > 0) {
          months.push({
            month: currentMonth,
            weeks: monthWeeks,
          });
        }
        currentMonth = monthKey;
        monthWeeks = [week];
      } else {
        monthWeeks.push(week);
      }
    }
  });

  // Add the last month
  if (currentMonth && monthWeeks.length > 0) {
    months.push({
      month: currentMonth,
      weeks: monthWeeks,
    });
  }

  return { months };
}

function ActivityGraph({ activity }: { activity: ActivityData['activity'] }) {
  const gridData = useMemo(() => groupActivityByWeeks(activity), [activity]);
  const totalActivity = useMemo(() => activity.reduce((sum, day) => sum + day.count, 0), [activity]);
  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Typography variant="secondary" type="footnote">
          {totalActivity.toLocaleString()} activities in the last year
        </Typography>
      </div>

      <div className="flex gap-3">
        {/* Day labels column */}
        <div className="flex flex-col">
          <div className="h-[20px]" /> {/* Spacer for month labels */}
          <div className="flex flex-row gap-[3px]">
            {dayNames.map((day, index) => (
              <Typography key={index} variant="secondary" type="footnote" className="text-[10px] w-[11px] text-center leading-[11px]">
                {day}
              </Typography>
            ))}
          </div>
        </div>

        {/* Activity grid */}
        <div className="flex-1 overflow-y-auto max-h-[600px]">
          {gridData.months.map((month, monthIndex) => (
            <div key={`${month.month}-${monthIndex}`} className="mb-4">
              {/* Month label */}
              <Typography variant="secondary" type="footnote" className="text-[10px] font-semibold mb-2">
                {month.month}
              </Typography>

              {/* Weeks for this month */}
              <div className="space-y-[3px]">
                {month.weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className="flex gap-[3px]">
                    {week.days.map((day, dayIndex) => {
                      if (!day) {
                        return (
                          <div
                            key={dayIndex}
                            className="w-[11px] h-[11px] rounded-sm bg-transparent"
                          />
                        );
                      }

                      const level = getActivityLevel(day.count);
                      const date = new Date(day.date);
                      const formattedDate = date.toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      });

                      return (
                        <SimpleTooltip
                          key={dayIndex}
                          tooltip={`${day.count} ${day.count === 1 ? 'activity' : 'activities'} on ${formattedDate}`}
                        >
                          <div
                            className={cn(
                              "w-[11px] h-[11px] rounded-sm transition-colors cursor-default",
                              level === 0 && "bg-muted/30",
                              level === 1 && "bg-green-200 dark:bg-green-900/40",
                              level === 2 && "bg-green-300 dark:bg-green-800/60",
                              level === 3 && "bg-green-400 dark:bg-green-700/80",
                              level === 4 && "bg-green-500 dark:bg-green-600"
                            )}
                          />
                        </SimpleTooltip>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs pt-2 border-t">
        <span className="text-muted-foreground">Less</span>
        <div className="flex gap-[3px]">
          {[0, 1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className={cn(
                "w-[11px] h-[11px] rounded-sm",
                level === 0 && "bg-muted/30",
                level === 1 && "bg-green-200 dark:bg-green-900/40",
                level === 2 && "bg-green-300 dark:bg-green-800/60",
                level === 3 && "bg-green-400 dark:bg-green-700/80",
                level === 4 && "bg-green-500 dark:bg-green-600"
              )}
            />
          ))}
        </div>
        <span className="text-muted-foreground">More</span>
      </div>
    </div>
  );
}

export function UserActivityCard({ userId }: { userId: string }) {
  const adminApp = useAdminApp();

  const { data: activityData, isLoading } = useQuery({
    queryKey: ['userActivity', userId],
    queryFn: () => fetchUserActivity(adminApp, userId),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !activityData ? (
          <UserActivityCardSkeletonContent />
        ) : (
          <ActivityGraph activity={activityData.activity} />
        )}
      </CardContent>
    </Card>
  );
}

function UserActivityCardSkeletonContent() {
  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const monthsToShow = 6;
  const weeksPerMonth = 4;

  return (
    <div className="space-y-4">
      <div className="h-4 w-40 bg-muted/50 rounded animate-pulse" />

      <div className="flex gap-3">
        {/* Day labels column */}
        <div className="flex flex-col">
          <div className="h-[20px]" />
          <div className="flex flex-row gap-[3px]">
            {dayNames.map((day, index) => (
              <Typography key={index} variant="secondary" type="footnote" className="text-[10px] w-[11px] text-center leading-[11px] opacity-50">
                {day}
              </Typography>
            ))}
          </div>
        </div>

        {/* Activity grid skeleton */}
        <div className="flex-1 overflow-y-auto max-h-[600px]">
          {Array.from({ length: monthsToShow }).map((_, monthIndex) => (
            <div key={monthIndex} className="mb-4">
              {/* Month label skeleton */}
              <div
                className="h-3 w-20 bg-muted/50 rounded animate-pulse mb-2"
                style={{
                  animationDelay: `${monthIndex * 0.1}s`,
                }}
              />

              {/* Weeks skeleton */}
              <div className="space-y-[3px]">
                {Array.from({ length: weeksPerMonth }).map((_, weekIndex) => (
                  <div key={weekIndex} className="flex gap-[3px]">
                    {Array.from({ length: 7 }).map((_, dayIndex) => {
                      const delay = (monthIndex * weeksPerMonth + weekIndex + dayIndex * 0.1) * 0.02;
                      return (
                        <div
                          key={dayIndex}
                          className="w-[11px] h-[11px] rounded-sm bg-muted/30"
                          style={{
                            animation: `skeleton-wave 2s ease-in-out infinite`,
                            animationDelay: `${delay}s`,
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs pt-2 border-t opacity-50">
        <span className="text-muted-foreground">Less</span>
        <div className="flex gap-[3px]">
          {[0, 1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className="w-[11px] h-[11px] rounded-sm bg-muted/30"
            />
          ))}
        </div>
        <span className="text-muted-foreground">More</span>
      </div>

      <style jsx>{`
        @keyframes skeleton-wave {
          0%, 100% {
            opacity: 0.2;
          }
          50% {
            opacity: 0.6;
          }
        }
      `}</style>
    </div>
  );
}

export function UserActivityCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>User Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <UserActivityCardSkeletonContent />
      </CardContent>
    </Card>
  );
}

