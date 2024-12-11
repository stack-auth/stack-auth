'use client';

import { Card, CardContent, CardDescription, CardTitle } from '@stackframe/stack-ui';
import { useEffect, useState } from 'react';
import { PageLayout } from "../page-layout";
import { useAdminApp } from '../use-admin-app';
import { GlobeSection } from './globe';
import { LineChartDisplay, LineChartDisplayConfig } from './line-chart';


const dailyRegistrationsConfig = {
  name: 'Daily Registrations',
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
  description: 'Unique daily user activity over the last 30 days',
  chart: {
    activity: {
      label: "Activity",
      color: "#2563eb",
    },
  }
} satisfies LineChartDisplayConfig;

export default function PageClient() {
  const [data, setData] = useState<any>(null);
  const adminApp = useAdminApp();

  // TODO HACK: use Suspense for this instead
  useEffect(() => {
    (adminApp as any).sendAdminRequest("/internal/metrics", {
      method: "GET",
    })
      .then((x: any) => x.json())
      .then((x: any) => setData(x))
      .catch((err: any) => { throw err; });
  }, [adminApp]);


  return (
    <PageLayout title="User Metric Dashboard">
      {
        data !== null && <>
          <GlobeSection countryData={data.users_by_country}>
            <Card>
              <CardContent>
                <CardTitle className='text-2xl'>
                  {data.total_users}
                </CardTitle>
                <CardDescription className='text-xl'>Total Users</CardDescription>
              </CardContent>
              <CardContent>
                <CardTitle className='text-2xl'>
                  {data.daily_active_users[data.daily_active_users.length - 1].activity}
                </CardTitle>
                <CardDescription className='text-xl'>Active Users Today</CardDescription>
              </CardContent>
            </Card>
          </GlobeSection>
          <LineChartDisplay
            config={dailyRegistrationsConfig}
            datapoints={data.daily_users}
          />
          <LineChartDisplay
            config={dauConfig}
            datapoints={data.daily_active_users}
          />
        </>
      }
    </PageLayout>
  );
}
