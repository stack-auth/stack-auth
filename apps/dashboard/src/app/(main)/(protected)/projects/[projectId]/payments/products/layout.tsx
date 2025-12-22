"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SelectField } from "@/components/form-fields";
import { Link } from "@/components/link";
import { StripeConnectProvider } from "@/components/payments/stripe-connect-provider";
import { cn } from "@/lib/utils";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionDialog, Button, Card, CardContent, Typography } from "@/components/ui";
import { ConnectNotificationBanner } from "@stripe/react-connect-js";
import { AlertTriangle, ArrowRight, BarChart3, FlaskConical, Repeat, Shield, Wallet, Webhook } from "lucide-react";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const [bannerHasItems, setBannerHasItems] = useState(false);
  const stackAdminApp = useAdminApp();
  const stripeAccountInfo = stackAdminApp.useStripeAccountInfo();
  const project = stackAdminApp.useProject();
  const paymentsConfig = project.useConfig().payments;

  // Hide banners on the new product page for a cleaner creation experience
  const isNewProductPage = pathname.endsWith('/products/new');

  const setupPayments = async () => {
    const { url } = await stackAdminApp.setupPayments();
    window.location.href = url;
    await wait(2000);
  };

  const handleDisableTestMode = async () => {
    await project.updateConfig({ "payments.testMode": false });
  };

  const handleEnableTestMode = async () => {
    await project.updateConfig({ "payments.testMode": true });
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

  // On the new product page, skip all banners for a cleaner experience
  if (isNewProductPage) {
    return (
      <StripeConnectProvider>
        {children}
      </StripeConnectProvider>
    );
  }

  return (
    <StripeConnectProvider>
      {paymentsConfig.testMode ? (
        <div className="flex justify-center px-4 pt-4 sm:px-6 sm:pt-6">
          <div className={cn(
            "w-full max-w-[1250px] rounded-2xl p-4 sm:p-5",
            "bg-blue-500/[0.08] dark:bg-blue-500/[0.12]",
            "ring-1 ring-blue-500/20 dark:ring-blue-400/20",
            "backdrop-blur-sm"
          )}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 dark:bg-blue-400/15">
                  <FlaskConical className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="space-y-2">
                  <div className="space-y-0.5">
                    <Typography type="label" className="text-sm font-medium text-blue-900 dark:text-blue-200">
                      Test mode active
                    </Typography>
                    <Typography type="p" className="text-xs text-blue-800/70 dark:text-blue-300/70">
                      All checkouts are bypassed and no real payments are processed.
                    </Typography>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "No credit card required",
                      "Products granted instantly",
                      "No Stripe transactions",
                      "Product changes apply to production",
                    ].map((item) => (
                      <span
                        key={item}
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium",
                          "bg-blue-500/10 dark:bg-blue-400/15",
                          "text-blue-700 dark:text-blue-300",
                          "ring-1 ring-blue-500/20 dark:ring-blue-400/20"
                        )}
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDisableTestMode()}
                className={cn(
                  "shrink-0 text-xs font-medium",
                  "border-blue-500/30 dark:border-blue-400/30",
                  "text-blue-700 dark:text-blue-300",
                  "hover:bg-blue-500/10 dark:hover:bg-blue-400/10",
                  "transition-colors duration-150 hover:transition-none"
                )}
              >
                Disable test mode
              </Button>
            </div>
          </div>
        </div>
      ) : !stripeAccountInfo.details_submitted && (
        <div className="flex justify-center px-4 pt-4 sm:px-6 sm:pt-6">
          <div className={cn(
            "w-full max-w-[1250px] rounded-2xl p-4 sm:p-5",
            "bg-amber-500/[0.08] dark:bg-amber-500/[0.12]",
            "ring-1 ring-amber-500/20 dark:ring-amber-400/20",
            "backdrop-blur-sm"
          )}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 dark:bg-amber-400/15">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="space-y-2">
                  <div className="space-y-0.5">
                    <Typography type="label" className="text-sm font-medium text-amber-900 dark:text-amber-200">
                      Finish setting up payments
                    </Typography>
                    <Typography type="p" className="text-xs text-amber-800/70 dark:text-amber-300/70">
                      Complete onboarding to unlock full capabilities.
                    </Typography>
                  </div>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {[
                      ...(!stripeAccountInfo.charges_enabled ? ["Charge customers"] : []),
                      ...(!stripeAccountInfo.payouts_enabled ? ["Receive payouts"] : []),
                    ].map((item) => (
                      <li key={item} className="flex items-center gap-1.5 text-xs text-amber-800/70 dark:text-amber-300/70">
                        <span className="h-1 w-1 rounded-full bg-amber-500/60 dark:bg-amber-400/60" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleEnableTestMode()}
                  className={cn(
                    "text-xs font-medium gap-1.5",
                    "border-amber-500/30 dark:border-amber-400/30",
                    "text-amber-700 dark:text-amber-300",
                    "hover:bg-amber-500/10 dark:hover:bg-amber-400/10",
                    "transition-colors duration-150 hover:transition-none"
                  )}
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  <span>Enable test mode</span>
                </Button>
                <Button
                  size="sm"
                  onClick={() => setupPayments()}
                  className="gap-1.5"
                >
                  <span>Continue setup</span>
                  <ArrowRight className="h-3.5 w-3.5" />
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
