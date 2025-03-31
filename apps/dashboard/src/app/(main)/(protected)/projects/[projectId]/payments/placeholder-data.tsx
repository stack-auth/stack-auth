import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@stackframe/stack-ui";
import { DollarSign, TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

export function PlaceholderData() {
  const weeklyRevenueData = [
    { date: "Mon", revenue: 1250 },
    { date: "Tue", revenue: 1420 },
    { date: "Wed", revenue: 1070 },
    { date: "Thu", revenue: 1380 },
    { date: "Fri", revenue: 1480 },
    { date: "Sat", revenue: 920 },
    { date: "Sun", revenue: 750 },
  ];

  // Chart configuration
  const chartConfig: ChartConfig = {
    revenue: {
      label: 'Revenue',
      theme: {
        light: '#22c55e',
        dark: '#4ade80',
      },
    },
  };

  // Calculate weekly and total revenue
  const weeklyRevenue = weeklyRevenueData.reduce((sum, day) => sum + day.revenue, 0);
  const totalRevenue = 52350; // Mock total revenue

  return <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
    <Card className="md:col-span-3">
      <CardHeader>
        <CardTitle>Weekly Revenue</CardTitle>
        <CardDescription>Revenue generated in the past week</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="w-full h-[300px]" maxHeight={300}>
          <LineChart accessibilityLayer data={weeklyRevenueData}>
            <CartesianGrid
              horizontal={true}
              vertical={false}
            />
            <ChartTooltip
              content={<ChartTooltipContent labelKey="date" />}
            />
            <Line
              dataKey="revenue"
              fill="var(--color-revenue)"
              stroke="var(--color-revenue)"
              fillOpacity={1}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={60}
              tickFormatter={(value) => `$${value}`}
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>

    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Weekly Revenue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center">
            <DollarSign className="h-4 w-4 text-muted-foreground mr-2" />
            <div className="flex items-baseline">
              <span className="text-2xl font-bold">${weeklyRevenue.toLocaleString()}</span>
              <span className="text-xs text-muted-foreground ml-2">this week</span>
            </div>
          </div>
          <div className="text-xs text-green-500 flex items-center mt-1">
            <TrendingUp className="h-3 w-3 mr-1" />
            <span>+12.5% from last week</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center">
            <DollarSign className="h-4 w-4 text-muted-foreground mr-2" />
            <div className="flex items-baseline">
              <span className="text-2xl font-bold">${totalRevenue.toLocaleString()}</span>
              <span className="text-xs text-muted-foreground ml-2">all time</span>
            </div>
          </div>
          <div className="text-xs text-green-500 flex items-center mt-1">
            <TrendingUp className="h-3 w-3 mr-1" />
            <span>+23.8% from last month</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Active Subscribers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center">
            <div className="flex items-baseline">
              <span className="text-2xl font-bold">187</span>
              <span className="text-xs text-muted-foreground ml-2">subscribers</span>
            </div>
          </div>
          <div className="text-xs text-green-500 flex items-center mt-1">
            <TrendingUp className="h-3 w-3 mr-1" />
            <span>+5.2% from last week</span>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>;
}
