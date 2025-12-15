"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SelectField } from "@/components/form-fields";
import { Link } from "@/components/link";
import { StripeConnectProvider } from "@/components/payments/stripe-connect-provider";
import { cn } from "@/lib/utils";
import { ArrowRightIcon, ArrowsClockwiseIcon, ChartBarIcon, FlaskIcon, ShieldIcon, WalletIcon, WarningIcon, WebhooksLogoIcon } from "@phosphor-icons/react";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionDialog, Button, Card, CardContent, Typography } from "@stackframe/stack-ui";
import { ConnectNotificationBanner } from "@stripe/react-connect-js";
import { useState } from "react";
import * as yup from "yup";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { useAdminApp } from "../../use-admin-app";

export default function PaymentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppEnabledGuard appId="payments">
      <PaymentsLayoutInner>{children}</PaymentsLayoutInner>
    </AppEnabledGuard>
  );
}

function PaymentsLayoutInner({ children }: { children: React.ReactNode }) {
  const [bannerHasItems, setBannerHasItems] = useState(false);
  const stackAdminApp = useAdminApp();
  const stripeAccountInfo = stackAdminApp.useStripeAccountInfo();
  const project = stackAdminApp.useProject();
  const paymentsConfig = project.useConfig().payments;

  const setupPayments = async () => {
    const { url } = await stackAdminApp.setupPayments();
    window.location.href = url;
    await wait(2000);
  };

  const handleDisableTestMode = async () => {
    await project.updateConfig({ "payments.testMode": false });
  };

  if (!stripeAccountInfo) {
    return (
      <div className="mx-auto max-w-sm h-full flex items-center">
        <Card className="w-full">
          <CardContent className="p-8 text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
              <WalletIcon className="h-6 w-6" />
            </div>
            <Typography type="h3" className="mb-4">Setup Payments</Typography>
            <Typography type="p" variant="secondary" className="mt-2">
              Let your users pay seamlessly and securely.
            </Typography>
            <ul className="mt-6 grid gap-3 text-left text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <WebhooksLogoIcon className="h-4 w-4 text-primary" />
                <span>No webhooks or syncing</span>
              </li>
              <li className="flex items-center gap-2">
                <ArrowsClockwiseIcon className="h-4 w-4 text-primary" />
                <span>One-time and recurring</span>
              </li>
              <li className="flex items-center gap-2">
                <ChartBarIcon className="h-4 w-4 text-primary" />
                <span>Usage-based billing</span>
              </li>
            </ul>
            <div className="mt-8 flex justify-center">
              <SetupPaymentsButton setupPayments={setupPayments} />
            </div>
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <ShieldIcon className="h-3.5 w-3.5" />
              <span>Powered by Stripe</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <StripeConnectProvider>
      {paymentsConfig.testMode ? (
        <div className="flex justify-center px-4 py-6">
          <div className="w-full max-w-[1250px] rounded-xl border border-blue-200 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 p-6 shadow-sm">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-blue-900 dark:text-blue-300">
                  <FlaskIcon className="h-5 w-5" />
                  <Typography type="h4" className="font-semibold">
                    You are currently in test mode
                  </Typography>
                </div>
                <Typography type="p" variant="secondary" className="text-blue-900/80 dark:text-blue-300/80">
                  All purchases are currently free and no money will be deducted.
                </Typography>
              </div>
              <div className="flex flex-col items-start self-stretch">
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => handleDisableTestMode()}
                  className="inline-flex items-center gap-2 mb-auto border-blue-300 dark:border-blue-600 text-blue-900 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                >
                  Disable test mode
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : !stripeAccountInfo.details_submitted && (
        <div className="flex justify-center px-4 py-6">
          <div className="w-full max-w-[1250px] rounded-xl border border-amber-200 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/20 p-6 shadow-sm">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-amber-900 dark:text-amber-300">
                  <WarningIcon className="h-5 w-5" />
                  <Typography type="h4" className="font-semibold">
                    Finish setting up payments
                  </Typography>
                </div>
                <Typography type="p" variant="secondary" className="text-amber-900/80 dark:text-amber-300/80">
                  Complete the onboarding to unlock full payment capabilities.
                </Typography>
                <ul className="space-y-1 text-sm text-amber-900/80 dark:text-amber-300/80">
                  {[
                    ...(!stripeAccountInfo.charges_enabled ? ["Start charging customers in production"] : []),
                    ...(!stripeAccountInfo.payouts_enabled ? ["Send payouts to your connected bank account"] : []),
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col items-start self-stretch">
                <Button
                  size="lg"
                  onClick={() => setupPayments()}
                  className="inline-flex items-center gap-2 mb-auto"
                >
                  Continue setup
                  <ArrowRightIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
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
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
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
            <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
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
          <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
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
