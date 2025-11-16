import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { CartesianGrid, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";

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
    <div className="relative overflow-hidden rounded-xl border border-border bg-card transition-all hover:shadow-lg group">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative p-5">
        <div className="mb-4">
          <h3 className="text-base font-semibold">{config.name}</h3>
          {config.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
          )}
        </div>
        <ChartContainer config={config.chart} className='w-full p-0 ml-[-20px]' maxHeight={280}>
          <LineChart accessibilityLayer data={datapoints} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid
              horizontal={true}
              vertical={false}
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              opacity={0.3}
            />
            <ChartTooltip
              content={<ChartTooltipContent labelKey='date'/>}
              cursor={{ stroke: 'var(--color-activity)', strokeWidth: 2, strokeDasharray: '5 5', opacity: 0.5 }}
            />
            <Line
              type="monotone"
              dataKey="activity"
              stroke="var(--color-activity)"
              strokeWidth={3}
              dot={false}
              activeDot={{
                r: 6,
                fill: 'var(--color-activity)',
                strokeWidth: 2,
                stroke: 'hsl(var(--background))',
              }}
              isAnimationActive={false}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={50}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              tickMargin={8}
              axisLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
              tickFormatter={(value) => value}
            />
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  );
}

const BRAND_CONFIG = {
  email: {
    label: 'Email',
    color: 'hsl(210, 40%, 55%)'
  },
  magiclink: {
    label: 'Magic Link',
    color: 'hsl(270, 85%, 65%)'
  },
  passkey: {
    label: 'Passkey',
    color: 'hsl(270, 70%, 80%)'
  },
  google: {
    label: 'Google',
    color: 'hsl(15, 90%, 55%)',
  },
  github: {
    label: 'GitHub',
    color: 'hsl(0, 0%, 20%)',
  },
  microsoft: {
    label: 'Microsoft',
    color: 'hsl(8, 89%, 57%)',
  },
  spotify: {
    label: 'Spotify',
    color: 'hsl(141, 73%, 55%)'
  },
  facebook: {
    label: 'Facebook',
    color: 'hsl(214, 100%, 52%)',
  },
  discord: {
    label: 'Discord',
    color: 'hsl(235, 85%, 65%)',
  },
  gitlab: {
    label: 'GitLab',
    color: 'hsl(14, 96%, 57%)'
  },
  bitbucket: {
    label: 'Bitbucket',
    color: 'hsl(208, 100%, 40%)',
  },
  linkedin: {
    label: 'LinkedIn',
    color: 'hsl(201, 100%, 40%)',
  },
  apple: {
    label: 'Apple',
    color: 'hsl(330, 85%, 65%)',
  },
  x: {
    label: 'X (Twitter)',
    color: 'hsl(0, 0%, 30%)',
  },
  password: {
    label: 'Password',
    color: 'hsl(180, 100%, 27%)',
  },
  other: {
    label: 'Other',
    color: 'hsl(60, 100%, 50%)',
  },
  otp: {
    label: 'OTP/Magic Link',
    color: 'hsl(330, 100%, 50%)',
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
    <div className="relative overflow-hidden rounded-xl border border-border bg-card transition-all hover:shadow-lg">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 hover:opacity-100 transition-opacity" />
      <div className="relative p-5">
        <div className="mb-3">
          <h3 className="text-base font-semibold">Auth Methods</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Login distribution</p>
        </div>
        <ChartContainer config={BRAND_CONFIG} className='w-full flex items-center justify-center' maxHeight={220}>
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
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
              labelLine={false}
              isAnimationActive={false}
              label={(x) => {
                const total = datapoints.reduce((sum, d) => sum + d.count, 0);
                const percentage = ((x.count / total) * 100).toFixed(0);
                return percentage !== '0' ? `${percentage}%` : '';
              }}
            />
          </PieChart>
        </ChartContainer>
        <div className="mt-3 flex flex-wrap gap-2 justify-center">
          {datapoints.map((item) => (
            <div key={item.method} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: `var(--color-${item.method})` }}
              />
              <span className="text-xs font-medium">
                {new Map(Object.entries(BRAND_CONFIG)).get(item.method)?.label ?? item.method}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
