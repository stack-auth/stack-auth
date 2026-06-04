"use client";

import { ConnectPayouts } from "@stripe/react-connect-js";
import { Alert } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import { PageLayout } from "../../page-layout";
import { StripeConnectProvider } from "@/components/payments/stripe-connect-provider";
import { useAdminApp } from "../../use-admin-app";

/**
 * @dashboardReference payments/payouts
 * @dashboardReferenceDescription Stripe Connect payouts for connected accounts.
 *
 * ## Availability
 *
 * Hidden in **development environments** and **preview deployments** (alert explains why). In production, renders Stripe **ConnectPayouts** inside `StripeConnectProvider` after Stripe is linked on **Settings**.
 *
 * Operators manage payout schedules and balances here; connect Stripe first under **Payments → Settings**.
 */

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const isPreview = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true";

  return (
    <PageLayout title="Payouts">
      {isPreview || project.isDevelopmentEnvironment ? (
        <Alert>
          Payouts are unavailable in {project.isDevelopmentEnvironment ? "development environments" : "preview mode"}.
        </Alert>
      ) : (
        <StripeConnectProvider>
          <ConnectPayouts />
        </StripeConnectProvider>
      )}
    </PageLayout>
  );
}
