"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SettingCard } from "@/components/settings";
import { ActionCell, Button, DataTable, DataTableColumnHeader, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, TextCell, Typography } from "@stackframe/stack-ui";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { ConnectComponentsProvider, ConnectPayments } from "@stripe/react-connect-js";
import { ColumnDef } from "@tanstack/react-table";
import { Info, WalletMinimal } from "lucide-react";
import { useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { PlaceholderData } from "./placeholder-data";

export default function PageClient() {
  const [isStripeKeyDialogOpen, setIsStripeKeyDialogOpen] = useState(false);
  const [isStripeConnectDialogOpen, setIsStripeConnectDialogOpen] = useState(false);
  const [isConfigurationMethodDialogOpen, setIsConfigurationMethodDialogOpen] = useState(false);

  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const stripeConfig = project.config.stripeConfig;
  const stripeConfigured = !!stripeConfig;
  const isStripeConnect = stripeConfigured && !!stripeConfig.stripeAccountId;
  const isDirectKeys = stripeConfigured && !!stripeConfig.stripeSecretKey;

  const configureStripe = () => {
    setIsConfigurationMethodDialogOpen(true);
  };


  return (
    <PageLayout
      title="Payments"
      description="Configure payment providers for your application"
      actions={
        <div className="flex items-center gap-2">
          <Button onClick={configureStripe}>
            {stripeConfigured ? "Update Stripe Configuration" : "Configure Stripe"}
          </Button>
          {stripeConfigured && (
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
          )}
        </div>
      }
    >
      {stripeConfigured && (
        <PlaceholderData />
      )}

      {!stripeConfigured && (
        <SettingCard
          title="Stripe"
          description="Not configured"
          actions={
            <Button onClick={configureStripe}>Configure Stripe</Button>
          }
        >
          <div className="flex items-center gap-3">
            <WalletMinimal />
            <Typography>
              Connect your Stripe account to enable payment processing in your application.
            </Typography>
          </div>
        </SettingCard>
      )}

      {stripeConfigured && (
        <SettingCard
          title="Stripe Configuration"
          description={isStripeConnect ? "Connected via Stripe Connect" : "Connected via API Keys"}
          actions={
            <Button onClick={configureStripe}>Update Configuration</Button>
          }
        >
          <div className="flex items-center gap-3">
            <WalletMinimal />
            <Typography>
              {isStripeConnect
                ? `Your application is connected to Stripe via Stripe Connect (Account ID: ${stripeConfig.stripeAccountId})`
                : "Your application is connected to Stripe via manual API keys."}
            </Typography>
          </div>
        </SettingCard>
      )}
      {stripeConfig && stripeConfig.stripeAccountId && <StripeConnectSection />}

      <StripeConfigurationMethodDialog
        open={isConfigurationMethodDialogOpen}
        onOpenChange={setIsConfigurationMethodDialogOpen}
        onSelectConnect={() => {
          setIsConfigurationMethodDialogOpen(false);
          setIsStripeConnectDialogOpen(true);
        }}
        onSelectManual={() => {
          setIsConfigurationMethodDialogOpen(false);
          setIsStripeKeyDialogOpen(true);
        }}
        currentMethod={isStripeConnect ? "connect" : isDirectKeys ? "manual" : undefined}
      />

      <StripeConnectDialog
        open={isStripeConnectDialogOpen}
        onOpenChange={setIsStripeConnectDialogOpen}
      />

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

function StripeConnectSection() {
  const stackAdminApp = useAdminApp();
  const [errorMessage, setErrorMessage] = useState('');

  const [connectInstance] = useState(() => {
    const fetchClientSecret = async () => {
      try {
        const result = await stackAdminApp.getStripeAccountSession();
        return result.clientSecret;
      } catch (error) {
        console.error('Error fetching Stripe account session client secret:', error);
        setErrorMessage((error as any).toString());
        return '';
      }
    };

    return loadConnectAndInitialize({
      publishableKey: 'pk_test_51PG1x62NZrVPeGHsPOSW8tQ6X80XtXeorCiEJYWraaXxtkAhm1jU21EU4CY3MLVrKqCKPw9o9Dtpgfe3fBT2Od1d00DqG2OPkp',
      fetchClientSecret,
    });
  });

  if (errorMessage) {
    return (
      <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 rounded-md text-red-600 dark:text-red-400 text-sm">
        {errorMessage}
      </div>
    );
  }

  return (
    <ConnectComponentsProvider connectInstance={connectInstance}>
      <ConnectPayments />
      <div>
        placeholder
      </div>
    </ConnectComponentsProvider>
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

function StripeConfigurationMethodDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onSelectConnect: () => void,
  onSelectManual: () => void,
  currentMethod?: "connect" | "manual",
}) {
  // We can't use SmartFormDialog with children, so we'll use ActionDialog directly
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Info className="h-4 w-4 mr-2"/>
            Configure Stripe
          </DialogTitle>
          <DialogDescription>
            Choose how you want to connect your application to Stripe
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="pb-2">
          <div className="flex flex-col gap-4 my-4">
            <div className="flex flex-col gap-2">
              <Typography className="text-xl font-bold">Configuration Methods</Typography>
              <Typography variant="secondary">
                There are two ways to connect your application to Stripe. Choose the one that best fits your needs.
              </Typography>
            </div>

            <div className="flex flex-col gap-4 mt-2">
              <Button
                onClick={props.onSelectConnect}
                className="justify-start h-auto py-4"
                variant="outline"
              >
                <div className="flex flex-col items-start text-left gap-1">
                  <Typography className="font-semibold">Stripe Connect (Recommended)</Typography>
                  <Typography variant="secondary" className="font-normal">
                    Allow Stack Auth to handle the integration with Stripe.
                    <br />
                    This is the simplest and most secure way to integrate with Stripe.
                  </Typography>
                </div>
              </Button>

              <Button
                onClick={props.onSelectManual}
                className="justify-start h-auto py-4"
                variant="outline"
              >
                <div className="flex flex-col items-start text-left gap-1">
                  <Typography className="font-semibold">Manual API Keys</Typography>
                  <Typography variant="secondary" className="font-normal">
                    Configure your integration by providing your API keys.
                    <br />
                    Use this if you need more control over your Stripe integration.
                  </Typography>
                </div>
              </Button>
            </div>
          </div>
        </DialogBody>

        <DialogFooter className="gap-2">
          <Button
            variant="secondary"
            color="neutral"
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StripeConnectDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onStripeConnected?: () => void,
}) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateAccount = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const baseUrl = window.location.origin + window.location.pathname;

      const stripeConnect = await stackAdminApp.createStripeConnectIntegration({
        type: 'standard',
        return_url: `${baseUrl}?stripeConnectSuccess=true`,
        refresh_url: `${baseUrl}?stripeConnectRefresh=true`,
      });

      // Redirect to the Stripe Connect account link URL
      if (stripeConnect.accountLinkUrl) {
        window.location.href = stripeConnect.accountLinkUrl;
      }

      props.onStripeConnected?.();
    } catch (err) {
      console.error('Error creating Stripe Connect account:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect with Stripe</DialogTitle>
          <DialogDescription>
            Create a new Stripe Connect account for your application
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="py-4">
          <div className="flex flex-col gap-4">
            <Typography>
              Clicking Create Account will:
            </Typography>
            <ul className="list-disc pl-6 space-y-1">
              <li>Create a new Stripe Connect account for your project</li>
              <li>Redirect you to Stripe to complete the onboarding process</li>
              <li>Link the account to your project once onboarding is complete</li>
            </ul>

            {error && (
              <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 rounded-md text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}
          </div>
        </DialogBody>

        <DialogFooter className="gap-2">
          <Button
            variant="secondary"
            color="neutral"
            onClick={() => props.onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateAccount}
            disabled={isLoading}
          >
            {isLoading ? "Creating Account..." : "Create Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      title="Configure Stripe API Keys"
      description="Manually configure your Stripe integration by providing your API keys"
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
