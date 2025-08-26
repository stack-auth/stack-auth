"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SelectField } from "@/components/form-fields";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import {
  Button,
  Card,
  CardContent,
  Typography,
  toast
} from "@stackframe/stack-ui";
import { ConnectPayments } from "@stripe/react-connect-js";
import { ArrowRight, BarChart3, Repeat, Shield, Wallet, Webhook } from "lucide-react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const stripeAccountId = config.payments.stripeAccountId;
  const paymentsConfig = config.payments;

  const setupPayments = async () => {
    const { url } = await stackAdminApp.setupPayments();
    window.location.href = url;
    await wait(2000);
  };

  if (!stripeAccountId) {
    return (
      <div className="mx-auto max-w-sm h-full flex items-center">
        <Card className="w-full">
          <CardContent className="p-8 text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
              <Wallet className="h-6 w-6" />
            </div>
            <Typography type="h3" className="mb-4">Setup Payments</Typography>
            <Typography type="p" variant="secondary" className="mt-2">
              Let your users pay seamlessly and securely.
            </Typography>
            <ul className="mt-6 grid gap-3 text-left text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-primary" />
                <span>No webhooks or syncing</span>
              </li>
              <li className="flex items-center gap-2">
                <Repeat className="h-4 w-4 text-primary" />
                <span>One-time and recurring</span>
              </li>
              <li className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <span>Usage-based billing</span>
              </li>
            </ul>
            <div className="mt-8 flex justify-center">
              <SetupPaymentsButton setupPayments={setupPayments} />
            </div>
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              <span>Powered by Stripe</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PageLayout
      title="Payments"
      actions={<div className="flex gap-2">
        {!paymentsConfig.stripeAccountSetupComplete && (
          <Button onClick={setupPayments}>Complete Setup</Button>
        )}
      </div>}
    >
      <div className="flex justify-center">
        <div style={{ maxWidth: 1250, width: '100%' }}>
          <ConnectPayments />
        </div>
      </div>
    </PageLayout >
  );
}

function SetupPaymentsButton({ setupPayments }: { setupPayments: () => Promise<void> }) {
  return (
    <SmartFormDialog
      title="Set up payments"
      formSchema={yup.object({
        country: yup.string().oneOf(["US", "OTHER"]).defined().label("Country of residence").meta({
          stackFormFieldRender: (props: any) => (
            <SelectField
              {...props}
              label="Country of residence"
              required
              options={[
                { value: "US", label: "United States" },
                { value: "OTHER", label: "Other" },
              ]}
            />
          ),
        }),
      })}
      cancelButton
      okButton={{ label: "Continue" }}
      trigger={
        <Button className="group">
          <span className="inline-flex items-center gap-2">
            Start Setup
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Button>
      }
      onSubmit={async (values) => {
        if (values.country !== "US") {
          toast({ title: "Payments is currently only available in the United States", variant: "destructive" });
          return "prevent-close";
        }
        await setupPayments();
      }}
    />
  );
}
