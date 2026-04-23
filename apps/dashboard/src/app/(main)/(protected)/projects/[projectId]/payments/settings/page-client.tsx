"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Switch, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { cn } from "@/lib/utils";
import { ProhibitIcon } from "@phosphor-icons/react";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { PaymentMethods } from "./payment-methods";
import { StripeConnectionCheck } from "./stripe-connection-check";
import { TestModeToggle } from "./test-mode-toggle";

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const paymentsConfig = project.useConfig().payments;
  const updateConfig = useUpdateConfig();

  const handleBlockNewPurchasesToggle = async (checked: boolean) => {
    await updateConfig({
      adminApp,
      configUpdate: { "payments.blockNewPurchases": checked },
      pushable: true,
    });
  };

  return (
    <PageLayout
      title="Settings"
      description="Manage a few global payment behaviors."
    >
      <div className="space-y-6 max-w-3xl">
        <StripeConnectionCheck />
        <TestModeToggle />
        <PaymentMethods />
        <Card>
          <CardHeader>
            <CardTitle>Block New Purchases</CardTitle>
            <CardDescription>
              Stops new checkouts while keeping existing subscriptions active.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  paymentsConfig.blockNewPurchases
                    ? "bg-red-500/15 dark:bg-red-400/15"
                    : "bg-muted"
                )}>
                  <ProhibitIcon className={cn(
                    "h-4 w-4",
                    paymentsConfig.blockNewPurchases
                      ? "text-red-600 dark:text-red-400"
                      : "text-muted-foreground"
                  )} />
                </div>
                <Typography className="font-medium">
                  Block new purchases
                </Typography>
              </div>
              <Switch
                checked={paymentsConfig.blockNewPurchases}
                onCheckedChange={handleBlockNewPurchasesToggle}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
