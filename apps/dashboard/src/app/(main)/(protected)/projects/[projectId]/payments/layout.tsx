"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SelectField } from "@/components/form-fields";
import { Link } from "@/components/link";
import { StripeConnectProvider } from "@/components/payments/stripe-connect-provider";
import { cn } from "@/lib/utils";
import { runAsynchronouslyWithAlert, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, Typography } from "@stackframe/stack-ui";
import { ConnectNotificationBanner } from "@stripe/react-connect-js";
import { ArrowRight, BarChart3, Repeat, Shield, Wallet, Webhook } from "lucide-react";
import { useState } from "react";
import * as yup from "yup";
import { useAdminApp } from "../use-admin-app";

export default function PaymentsLayout({ children }: { children: React.ReactNode }) {
  const [bannerHasItems, setBannerHasItems] = useState(false);
  const stackAdminApp = useAdminApp();
  const stripeAccountInfo = stackAdminApp.useStripeAccountInfo?.();

  const setupPayments = async () => {
    const { url } = await stackAdminApp.setupPayments();
    window.location.href = url;
    await wait(2000);
  };

  if (!stripeAccountInfo) {
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
    <StripeConnectProvider>
      {!stripeAccountInfo.details_submitted && (
        <div className="flex justify-center p-4" >
          <Alert variant="destructive" style={{ maxWidth: 1250, width: '100%' }}>
            <AlertTitle>Incomplete setup</AlertTitle>
            <AlertDescription>
              Stripe account is not fully setup.
              You can test your application, but please{" "}
              <Link
                href="#"
                className="underline"
                onClick={() => runAsynchronouslyWithAlert(setupPayments)}
              >
                complete the setup process
              </Link>
              {" "}to{" "}
              {[
                ...!stripeAccountInfo.charges_enabled ? ["receive payments"] : [],
                ...!stripeAccountInfo.payouts_enabled ? ["send payouts"] : [],
              ].join(" and ")}.
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div className={cn(bannerHasItems && "p-4", "flex justify-center")}>
        <div style={{ maxWidth: 1250, width: '100%' }}>
          <ConnectNotificationBanner
            onNotificationsChange={({ total }) => setBannerHasItems(total > 0)}
            collectionOptions={{
              fields: "eventually_due",
            }}
          />
        </div>
      </div>
      {children}
    </StripeConnectProvider>
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
          alert("Payments are currently only available for businesses or individuals in the United States.");
          return "prevent-close";
        }
        await setupPayments();
      }}
    />
  );
}
