"use client";

import { ConnectPayouts } from "@stripe/react-connect-js";
import { PageLayout } from "../../page-layout";
import { StripeConnectProvider } from "@/components/payments/stripe-connect-provider";

export default function PageClient() {

  return (
    <PageLayout title="Payouts">
      <StripeConnectProvider>
        <ConnectPayouts />
      </StripeConnectProvider>
    </PageLayout>
  );
}
