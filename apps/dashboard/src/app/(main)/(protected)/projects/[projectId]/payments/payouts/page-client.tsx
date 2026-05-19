"use client";

import { ConnectPayouts } from "@stripe/react-connect-js";
import { Alert } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import { PageLayout } from "../../page-layout";
import { StripeConnectProvider } from "@/components/payments/stripe-connect-provider";
import { useAdminApp } from "../../use-admin-app";

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
