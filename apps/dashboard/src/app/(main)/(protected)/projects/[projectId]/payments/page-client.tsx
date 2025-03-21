"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SettingCard } from "@/components/settings";
import { ActionCell, Button, DataTable, DataTableColumnHeader, TextCell, Typography } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import { WalletMinimal } from "lucide-react";
import { useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";


export default function PageClient() {
  const [isStripeKeyDialogOpen, setIsStripeKeyDialogOpen] = useState(false);

  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const stripeConfigured = !!project.config.stripeConfig;

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
  const data: SubscriptionRole[] = [
    { id: "1", role: "premium", planId: "price_1234", planName: "Premium Monthly" },
    { id: "2", role: "pro", planId: "price_5678", planName: "Pro Monthly" },
    { id: "3", role: "enterprise", planId: "price_9012", planName: "Enterprise Annual" },
  ];

  const [subscriptionRoles, setSubscriptionRoles] = useState<SubscriptionRole[]>(data);

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
              onClick: () => {
                setSubscriptionRoles(prev =>
                  prev.filter(role => role.id !== row.original.id)
                );
              },
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="mt-4">
      <Button className="mb-4">Add Subscription Role</Button>
      <DataTable
        data={subscriptionRoles}
        columns={columns}
        defaultColumnFilters={[]}
        defaultSorting={[{ id: "role", desc: false }]}
      />
    </div>
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
    stripeSecretKey: yup.string().defined().label("Stripe Secret Key"),
    stripePublishableKey: yup.string().defined().label("Stripe Publishable Key"),
    stripeWebhookSecret: yup.string().label("Stripe Webhook Secret (optional)")
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
