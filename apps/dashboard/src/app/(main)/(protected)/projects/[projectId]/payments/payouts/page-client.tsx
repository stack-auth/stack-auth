"use client";

import { ConnectPayouts } from "@stripe/react-connect-js";
import { Alert } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import { PageLayout } from "../../page-layout";
import { StripeConnectProvider } from "@/components/payments/stripe-connect-provider";

export default function PageClient() {
  const isPreview = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true";

  return (
    <PageLayout title="Payouts">
      {isPreview ? (
        <Alert>
          Payouts are unavailable in preview mode.
        </Alert>
      ) : (
        <StripeConnectProvider>
          <ConnectPayouts />
        </StripeConnectProvider>
      )}
    </PageLayout>
  );
}
