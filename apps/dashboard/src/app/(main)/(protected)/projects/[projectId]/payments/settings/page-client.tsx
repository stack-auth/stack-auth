"use client";

import { PageLayout } from "../../page-layout";
import { PaymentMethods } from "./payment-methods";
import { StripeConnectionCheck } from "./stripe-connection-check";
import { TestModeToggle } from "./test-mode-toggle";
import { SettingSwitch } from "@/components/settings";
import { useAdminApp } from "../../use-admin-app";

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const paymentsConfig = project.useConfig().payments;

  return (
    <PageLayout
      title="Settings"
      description="Manage a few global payment behaviors."
    >
      <div className="space-y-6 max-w-3xl">
        <StripeConnectionCheck />
        <TestModeToggle />
        <PaymentMethods />
      </div>
      <SettingSwitch
        label="Block new purchases"
        checked={paymentsConfig.blockNewPurchases}
        onCheckedChange={(checked) => project.updateConfig({ "payments.blockNewPurchases": checked })}
        hint="Stops new checkouts while keeping existing subscriptions active."
      />
    </PageLayout>
  );
}
