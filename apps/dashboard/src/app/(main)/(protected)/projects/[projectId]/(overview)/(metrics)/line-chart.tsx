import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { isWeekend } from "@stackframe/stack-shared/dist/utils/dates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@stackframe/stack-ui";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";

export type LineChartDisplayConfig = {
  name: string,
  description?: string,
  chart: ChartConfig,
}

export type DataPoint = {
  date: string,
  activity: number,
}

export function LineChartDisplay({
  config, datapoints
}: {
  config: LineChartDisplayConfig,
  datapoints: DataPoint[],
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {config.name}
        </CardTitle>
        <CardDescription>
          {config.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config.chart} className='w-full p-0 ml-[-30px]' maxHeight={300}>
          <BarChart accessibilityLayer data={datapoints}>
            <CartesianGrid
              horizontal={true}
              vertical={false}
            />
            <ChartTooltip
              content={<ChartTooltipContent labelKey='date'/>}
            />
            <Bar
              dataKey="activity"
              fill="var(--color-activity)"
              fillOpacity={1}
              isAnimationActive={false}
            >{datapoints.map(x => (
              <Cell key={x.date} fillOpacity={isWeekend(new Date(x.date)) ? 0.4 : 1} />
            ))}</Bar>

            <YAxis
              tickLine={false}
              axisLine={false}
              width={60}
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tickFormatter={(value) => value}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const BRAND_CONFIG = {
  email: {
    label: 'Email',
    color: '#ffffff'
  },
  magiclink: {
    label: 'Magic Link',
    color: '#A657F0'
  },
  passkey: {
    label: 'Passkey',
    color: '#D2B6EF'
  },
  google: {
    label: 'Google',
    color: '#F3801D',
  },
  github: {
    label: 'GitHub',
    color: '#222222',
  },
  microsoft: {
    label: 'Microsoft',
    color: '#F35325',
  },
  spotify: {
    label: 'Spotify',
    color: '#1ED760'
  },
  facebook: {
    label: 'Facebook',
    color: '#0866FF',
  },
  discord: {
    label: 'Discord',
    color: '#5865F2',
  },
  gitlab: {
    label: 'GitLab',
    color: '#FC6D26'
  },
  bitbucket: {
    label: 'Bitbucket',
    color: '#0052CC',
  },
  linkedin: {
    label: 'LinkedIn',
    color: '#0A66C2',
  },
  apple: {
    label: 'Apple',
    color: '#F47CAD',
  },
  x: {
    label: 'X (Twitter)',
    color: '#444444',
  },
  password: {
    label: 'Password',
    color: '#008888',
  },
  other: {
    label: 'Other',
    color: '#ffff00',
  },
  otp: {
    label: 'OTP/Magic Link',
    color: '#ff0088',
  },
};

export type AuthMethodDatapoint = {
  method: keyof typeof BRAND_CONFIG,
  count: number,
};

export function DonutChartDisplay({
  datapoints
}: {
  datapoints: AuthMethodDatapoint[],
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Auth Methods
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={BRAND_CONFIG} className='w-full p-4' maxHeight={300}>
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={datapoints.map(x => ({
                ...x,
                fill: `var(--color-${x.method})`
              }))}
              dataKey="count"
              nameKey="method"
              innerRadius={60}
              labelLine={false}
              isAnimationActive={false}
              label={(x) => `${new Map(Object.entries(BRAND_CONFIG)).get(x.method)?.label ?? x.method}: ${x.count}`}
            />
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
