import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@stackframe/stack-ui";
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

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;

  const data = payload[0].payload;
  const date = new Date(data.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : data.date;

  return (
    <div className="rounded-xl border border-border/70 bg-background/90 px-3 py-2 text-xs shadow-xl">
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.7rem] font-medium text-muted-foreground">
          {formattedDate}
        </span>
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: "var(--color-activity)" }}
          />
          <span className="text-[0.7rem] text-muted-foreground">
            Activity
          </span>
          <span className="ml-auto font-mono text-[0.7rem] font-semibold tabular-nums text-foreground">
            {typeof data.activity === "number"
              ? data.activity.toLocaleString()
              : data.activity}
          </span>
        </div>
      </div>
    </div>
  );
};

export function LineChartDisplay({
  config, datapoints
}: {
  config: LineChartDisplayConfig,
  datapoints: DataPoint[],
}) {
  return (
    <Card className="transition-all">
      <CardHeader className="pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold">{config.name}</CardTitle>
          {config.description && (
            <CardDescription className="text-xs">
              {config.description}
            </CardDescription>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ChartContainer
          config={config.chart}
          className="w-full"
          maxHeight={280}
        >
          <LineChart
            accessibilityLayer
            data={datapoints}
            margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              horizontal
              vertical={false}
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              opacity={0.3}
            />
            <ChartTooltip
              content={<CustomTooltip />}
              cursor={{
                stroke: "var(--color-activity)",
                strokeWidth: 2,
                strokeDasharray: "5 5",
                opacity: 0.5,
              }}
            />
            <Line
              type="monotone"
              dataKey="activity"
              stroke="var(--color-activity)"
              strokeWidth={3}
              dot={false}
              activeDot={{
                r: 6,
                fill: "var(--color-activity)",
                strokeWidth: 2,
                stroke: "hsl(var(--background))",
              }}
              isAnimationActive={false}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={50}
              tick={{
                fill: "hsl(var(--muted-foreground))",
                fontSize: 11,
              }}
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              tickMargin={8}
              axisLine={false}
              tick={{
                fill: "hsl(var(--muted-foreground))",
                fontSize: 10,
              }}
              tickFormatter={(value) => {
                const date = new Date(value);
                if (!isNaN(date.getTime())) {
                  const month = date.toLocaleDateString("en-US", {
                    month: "short",
                  });
                  const day = date.getDate();
                  return `${month} ${day}`;
                }
                return value;
              }}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
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
  const total = datapoints.reduce((sum, d) => sum + d.count, 0);

  return (
    <Card className="transition-all">
      <CardHeader className="pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold">Auth Methods</CardTitle>
          <CardDescription className="text-xs">
            Login distribution
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-col items-center">
          <ChartContainer
            config={BRAND_CONFIG}
            className="flex w-full items-center justify-center"
            maxHeight={200}
          >
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    className="rounded-xl border border-border/70 bg-background/90 px-3 py-1.5 text-xs shadow-xl"
                    hideIndicator
                    nameKey="method"
                    formatter={(value, _name, item) => {
                      const key = (item.payload as AuthMethodDatapoint | undefined)?.method;
                      const label = (key && BRAND_CONFIG[key].label) || _name;

                      if (typeof value !== "number" || !key) {
                        return null;
                      }

                      return (
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: `var(--color-${key})` }}
                          />
                          <span className="text-[0.7rem] font-medium">
                            {label}
                          </span>
                          <span className="font-mono text-[0.7rem] font-semibold tabular-nums">
                            {value}
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Pie
                data={datapoints.map(x => ({
                  ...x,
                  fill: `var(--color-${x.method})`
                }))}
                dataKey="count"
                nameKey="method"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={3}
                labelLine={false}
                isAnimationActive={false}
              />
            </PieChart>
          </ChartContainer>
          <div className="mt-4 flex max-w-md flex-wrap justify-center gap-2">
            {datapoints.map((item) => {
              const percentage = ((item.count / total) * 100).toFixed(0);
              return (
                <div
                  key={item.method}
                  className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs shadow-sm transition-colors hover:bg-muted/40"
                >
                  <span className="text-xs font-medium text-foreground">
                    {new Map(Object.entries(BRAND_CONFIG)).get(item.method)?.label ?? item.method}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({percentage}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
