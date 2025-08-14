"use client";

import { StripeConnectProvider } from "@/components/payments/stripe-connect-provider";
import { cn } from "@/lib/utils";
import { ConnectNotificationBanner } from "@stripe/react-connect-js";
import { useState } from "react";
import { useAdminApp } from "../use-admin-app";

export default function PaymentsLayout({ children }: { children: React.ReactNode }) {
  const [bannerHasItems, setBannerHasItems] = useState(false);
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const stripeAccountId = config.payments.stripeAccountId;

  if (!stripeAccountId) {
    return children;
  }

  return (
    <StripeConnectProvider>
      <div className={cn(bannerHasItems && "p-4", "flex justify-center")}>
        <div style={{ maxWidth: 1250, width: '100%' }}>
          <ConnectNotificationBanner
            onNotificationsChange={({ total }) => setBannerHasItems(total > 0)}
            collectionOptions={{
              fields: "currently_due",
            }}
          />
        </div>
      </div>
      {children}
    </StripeConnectProvider>
  );
}
