"use client";

import { SettingSwitch } from "@/components/settings";
import { PageLayout } from "../../page-layout";
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
      <SettingSwitch
        label="Block new purchases"
        checked={paymentsConfig.blockNewPurchases}
        onCheckedChange={async (checked) => {
          await project.updateConfig({ "payments.blockNewPurchases": checked });
        }}
        hint="Stops new checkouts while keeping existing subscriptions active."
      />
    </PageLayout>
  );
}
