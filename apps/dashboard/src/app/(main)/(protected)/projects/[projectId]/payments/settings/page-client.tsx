"use client";

import { SettingSwitch } from "@/components/settings";
import { useUpdateConfig } from "@/lib/config-update";
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
        onCheckedChange={async (checked) => void await updateConfig({
          adminApp,
          configUpdate: { "payments.blockNewPurchases": checked },
          pushable: true,
        })}
        hint="Stops new checkouts while keeping existing subscriptions active."
      />
    </PageLayout>
  );
}
