"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SettingCard } from "@/components/settings";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { ActionCell, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, DataTableColumnHeader, TextCell, Typography } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import { DollarSign, TrendingUp, WalletMinimal } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";


export default function PageClient() {
  const [isStripeKeyDialogOpen, setIsStripeKeyDialogOpen] = useState(false);

  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const stripeConfigured = !!project.config.stripeConfig;

  // Mock data for revenue chart
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

  return (
    <PageLayout
      title="Payments"
      description="Configure payment providers for your application"
      actions={
        <div className="flex items-center gap-2">
          <Button onClick={() => setIsStripeKeyDialogOpen(true)}>
            {stripeConfigured ? "Update Stripe Key" : "Configure Stripe"}
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              await project.update({
                config: {
                  stripeConfig: undefined,
                },
              });
            }}
          >
            Disable Stripe
          </Button>
        </div>
      }
    >
      {stripeConfigured && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
        </div>
      )}

      {!stripeConfigured && <SettingCard
        title="Stripe"
        description="Not configured"
        actions={
          <Button onClick={() => setIsStripeKeyDialogOpen(true)}>Configure Stripe</Button>
        }
      >
        <div className="flex items-center gap-3">
          <WalletMinimal />
          <Typography>
            Connect your Stripe account to enable payment processing in your application.
          </Typography>
        </div>
      </SettingCard>}

      <StripeKeyDialog
        open={isStripeKeyDialogOpen}
        onOpenChange={setIsStripeKeyDialogOpen}
      />

      {
        stripeConfigured && (
          <SettingCard
            title="Subscription Roles"
            description="Automatically assign roles to users based on their subscription status."
          >
            <SubscriptionRolesTable />
          </SettingCard>
        )
      }
    </PageLayout>
  );
}

type SubscriptionRole = {
  id: string,
  role: string,
  planId: string,
  planName: string,
}

function SubscriptionRolesTable() {
  // Mock data for the table
  const subscriptionRoles: SubscriptionRole[] = [
    { id: "1", role: "premium", planId: "price_1234", planName: "Premium Monthly" },
    { id: "2", role: "pro", planId: "price_5678", planName: "Pro Monthly" },
    { id: "3", role: "enterprise", planId: "price_9012", planName: "Enterprise Annual" },
  ];

  const [isAddRoleDialogOpen, setIsAddRoleDialogOpen] = useState(false);

  const columns: ColumnDef<SubscriptionRole>[] = [
    {
      accessorKey: "role",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Role" />,
      cell: ({ row }) => <TextCell>{row.original.role}</TextCell>,
    },
    {
      accessorKey: "planName",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Stripe Plan" />,
      cell: ({ row }) => <TextCell>{row.original.planName}</TextCell>,
    },
    {
      accessorKey: "planId",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Plan ID" />,
      cell: ({ row }) => <TextCell size={200}>{row.original.planId}</TextCell>,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <ActionCell
          items={[
            {
              item: "Edit",
              onClick: () => {
                // Handle edit action
              },
            },
            {
              item: "Delete",
              danger: true,
              onClick: () => {},
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="mt-4">
      <Button className="mb-4" onClick={() => setIsAddRoleDialogOpen(true)}>Add Subscription Role</Button>
      <DataTable
        data={subscriptionRoles}
        columns={columns}
        defaultColumnFilters={[]}
        defaultSorting={[{ id: "role", desc: false }]}
      />

      <AddSubscriptionRoleDialog
        open={isAddRoleDialogOpen}
        onOpenChange={setIsAddRoleDialogOpen}
        onRoleAdded={(role) => {
          // TODO: Add the role to the database
        }}
      />
    </div>
  );
}

function AddSubscriptionRoleDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onRoleAdded: (role: Omit<SubscriptionRole, "id">) => void,
}) {
  const formSchema = yup.object({
    role: yup.string().defined().label("Role Name"),
    planId: yup.string().defined().label("Stripe Plan ID"),
    planName: yup.string().defined().label("Plan Display Name"),
  });

  return (
    <SmartFormDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Add Subscription Role"
      description="Assign a role to users who subscribe to a specific Stripe plan"
      formSchema={formSchema}
      okButton={{ label: "Add" }}
      onSubmit={async (values) => {
        props.onRoleAdded({
          role: values.role,
          planId: values.planId,
          planName: values.planName,
        });
      }}
      cancelButton
    />
  );
}

function StripeKeyDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onKeyConfigured?: () => void,
}) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();

  const formSchema = yup.object({
    stripeSecretKey: yup.string()
      .defined()
      .matches(/^sk_[a-zA-Z0-9_]+$/, "Must be a valid Stripe secret key")
      .label("Stripe Secret Key"),
    stripePublishableKey: yup.string()
      .defined()
      .matches(/^pk_[a-zA-Z0-9_]+$/, "Must be a valid Stripe publishable key")
      .label("Stripe Publishable Key"),
    stripeWebhookSecret: yup.string()
      .matches(/^whsec_[a-zA-Z0-9_]+$/, "Must be a valid Stripe webhook secret")
      .label("Stripe Webhook Secret (optional)")
  });

  return (
    <SmartFormDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Configure Stripe"
      formSchema={formSchema}
      okButton={{ label: "Save" }}
      onSubmit={async (values) => {
        await project.update({
          config: {
            stripeConfig: {
              stripeSecretKey: values.stripeSecretKey,
              stripePublishableKey: values.stripePublishableKey,
              stripeWebhookSecret: values.stripeWebhookSecret,
            },
          }
        });
        props.onKeyConfigured?.();
      }}
      cancelButton
    />
  );
}
