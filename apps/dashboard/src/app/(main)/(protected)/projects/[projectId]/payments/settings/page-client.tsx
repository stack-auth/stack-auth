"use client";

import { SettingSwitch } from "@/components/settings";
import { useUpdateConfig } from "@/lib/config-update";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

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
