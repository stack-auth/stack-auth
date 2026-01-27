"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ArrowRightIcon, CheckCircleIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { useAdminApp } from "../../use-admin-app";

export function StripeConnectionCheck() {
  const adminApp = useAdminApp();
  const stripeAccountInfo = adminApp.useStripeAccountInfo();

  const setupPayments = async () => {
    const { url } = await adminApp.setupPayments();
    window.location.href = url;
    await wait(2000);
  };

  // Not connected to Stripe
  if (!stripeAccountInfo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stripe Connection</CardTitle>
          <CardDescription>
            Connect your Stripe account to accept payments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/15 dark:bg-red-400/15">
                <XCircleIcon className="h-4 w-4 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <Typography className="font-medium">Not connected</Typography>
                <Typography variant="secondary" className="text-sm">
                  Set up Stripe to start accepting payments.
                </Typography>
              </div>
            </div>
            <Button onClick={setupPayments} size="sm" className="gap-1.5">
              <span>Connect Stripe</span>
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Connected but onboarding incomplete
  if (!stripeAccountInfo.details_submitted) {
    const missingCapabilities = [
      ...(!stripeAccountInfo.charges_enabled ? ["Charge customers"] : []),
      ...(!stripeAccountInfo.payouts_enabled ? ["Receive payouts"] : []),
    ];

    return (
      <Card>
        <CardHeader>
          <CardTitle>Stripe Connection</CardTitle>
          <CardDescription>
            Your Stripe account connection status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 dark:bg-amber-400/15">
                <WarningCircleIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="space-y-1">
                <Typography className="font-medium">Setup incomplete</Typography>
                <Typography variant="secondary" className="text-sm">
                  Complete onboarding to unlock full capabilities.
                </Typography>
                {missingCapabilities.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {missingCapabilities.map((item) => (
                      <span
                        key={item}
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium",
                          "bg-amber-500/10 dark:bg-amber-400/15",
                          "text-amber-700 dark:text-amber-300",
                          "ring-1 ring-amber-500/20 dark:ring-amber-400/20"
                        )}
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <Button onClick={setupPayments} size="sm" variant="outline" className="gap-1.5">
              <span>Continue setup</span>
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Fully connected
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stripe Connection</CardTitle>
        <CardDescription>
          Your Stripe account connection status.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-500/15 dark:bg-green-400/15">
              <CheckCircleIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
            <div className="space-y-1">
              <Typography className="font-medium">Connected</Typography>
              <Typography variant="secondary" className="text-sm">
                Your Stripe account is fully set up and ready to accept payments.
              </Typography>
              <div className="flex flex-wrap gap-2 pt-1">
                {[
                  ...(stripeAccountInfo.charges_enabled ? ["Charges enabled"] : []),
                  ...(stripeAccountInfo.payouts_enabled ? ["Payouts enabled"] : []),
                ].map((item) => (
                  <span
                    key={item}
                    className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium",
                      "bg-green-500/10 dark:bg-green-400/15",
                      "text-green-700 dark:text-green-300",
                      "ring-1 ring-green-500/20 dark:ring-green-400/20"
                    )}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
