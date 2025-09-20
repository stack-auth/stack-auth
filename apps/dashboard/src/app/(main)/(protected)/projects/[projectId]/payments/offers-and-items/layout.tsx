"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SelectField } from "@/components/form-fields";
import { Link } from "@/components/link";
import { StripeConnectProvider } from "@/components/payments/stripe-connect-provider";
import { cn } from "@/lib/utils";
import { runAsynchronouslyWithAlert, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionDialog, Alert, AlertDescription, AlertTitle, Button, Card, CardContent, Typography } from "@stackframe/stack-ui";
import { ConnectNotificationBanner } from "@stripe/react-connect-js";
import { ArrowRight, BarChart3, Repeat, Shield, Wallet, Webhook } from "lucide-react";
import { useState } from "react";
import * as yup from "yup";
import { useAdminApp } from "../../use-admin-app";

export default function PaymentsLayout({ children }: { children: React.ReactNode }) {
  const [bannerHasItems, setBannerHasItems] = useState(false);
  const stackAdminApp = useAdminApp();
  const stripeAccountInfo = stackAdminApp.useStripeAccountInfo();

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
            <AlertTitle className="font-semibold">Incomplete setup</AlertTitle>
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
  const stackAdminApp = useAdminApp();
  const [screen, setScreen] = useState<"country-select" | "us-selected" | "other-selected">("country-select");
  const [isOpen, setIsOpen] = useState(false);

  const handleCountrySubmit = (country: string) => {
    if (country === "US") {
      setScreen("us-selected");
    } else {
      setScreen("other-selected");
    }
  };

  const handleBack = () => {
    setScreen("country-select");
  };

  const handleContinueOnboarding = async () => {
    await setupPayments();
    setIsOpen(false);
  };

  const handleDoThisLater = async () => {
    await stackAdminApp.setupPayments();
    window.location.reload();
    // Call setup endpoint but don't open URL
    setIsOpen(false);
  };

  const resetAndClose = () => {
    setScreen("country-select");
    setIsOpen(false);
  };

  if (screen === "country-select") {
    return (
      <SmartFormDialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) resetAndClose();
        }}
        title="Welcome to Payments!"
        description="Please select your or your company's country of residence below"
        formSchema={yup.object({
          country: yup.string().oneOf(["US", "OTHER"]).defined().label("Country of residence").meta({
            stackFormFieldRender: (props: any) => (
              <SelectField
                {...props}
                label="Country of residence"
                required
                options={[
                  { value: "US", label: "🇺🇸 United States" },
                  { value: "OTHER", label: "Other" },
                ]}
              />
            ),
          }),
        })}
        cancelButton
        okButton={{ label: "Continue" }}
        trigger={
          <Button className="group" onClick={() => setIsOpen(true)}>
            <span className="inline-flex items-center gap-2">
              Start Setup
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Button>
        }
        onSubmit={async (values): Promise<"prevent-close"> => {
          handleCountrySubmit(values.country);
          return "prevent-close";
        }}
      />
    );
  }

  if (screen === "us-selected") {
    return (
      <>
        <Button className="group" onClick={() => setIsOpen(true)}>
          <span className="inline-flex items-center gap-2">
            Start Setup
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Button>
        <ActionDialog
          open={isOpen}
          onOpenChange={(open) => {
            setIsOpen(open);
            if (!open) resetAndClose();
          }}
          title="Payments is available in your country!"
          description="You will be redirected to Stripe, our partner for payment processing, to connect your bank account. Or, you can do this later, and test Stack Auth Payments without setting up Stripe, but you will be limited to test transactions."
          cancelButton={false}
          okButton={false}
        >
          <div className="flex justify-between w-full pt-4">
            <Button variant="outline" onClick={handleBack}>
              Back
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleDoThisLater}>
                Do this later
              </Button>
              <Button onClick={handleContinueOnboarding}>
                Continue onboarding
              </Button>
            </div>
          </div>
        </ActionDialog>
      </>
    );
  }

  // Handle other-selected screen
  return (
    <>
      <Button className="group" onClick={() => setIsOpen(true)}>
        <span className="inline-flex items-center gap-2">
          Start Setup
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Button>
      <ActionDialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) resetAndClose();
        }}
        title="Sorry :("
        cancelButton={false}
        okButton={false}
      >
        <div className="mb-4">
          Stack Auth Payments is currently only available in the US. If you&apos;d like to be notified when we expand to other countries, please reach out to us on our{" "}
          <Link href="https://feedback.stack-auth.com" target="_blank" className="underline">
            Feedback platform
          </Link>
          .
        </div>
        <div className="flex justify-start w-full pt-4">
          <Button variant="outline" onClick={handleBack}>
            Back
          </Button>
        </div>
      </ActionDialog>
    </>
  );
}
