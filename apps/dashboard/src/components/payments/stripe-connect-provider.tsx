"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { getPublicEnvVar } from "@/lib/env";
import { StackAdminApp } from "@hexclave/next";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import {
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";
import { useTheme } from "@/lib/theme";
import { useEffect } from "react";
import { appearanceVariablesForTheme } from "./stripe-theme-variables";

const isPreview = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true";

type StripeConnectProviderProps = {
  children: React.ReactNode,
};

const stripeConnectInstances = new Map<string, ReturnType<typeof loadConnectAndInitialize>>();
export function getStripeConnectInstance(adminApp: StackAdminApp) {
  if (!stripeConnectInstances.has(adminApp.projectId)) {
    stripeConnectInstances.set(adminApp.projectId, loadConnectAndInitialize({
      publishableKey: getPublicEnvVar("NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY") ?? throwErr("No Stripe publishable key found"),
      fetchClientSecret: async () => {
        const { client_secret } = await adminApp.createStripeWidgetAccountSession();
        return client_secret;
      },
    }));
  }
  return stripeConnectInstances.get(adminApp.projectId)!;
}

export function StripeConnectProvider({ children }: StripeConnectProviderProps) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const { resolvedTheme } = useTheme();

  const stripeConnectInstance = isPreview || project.isDevelopmentEnvironment ? null : getStripeConnectInstance(adminApp);

  useEffect(() => {
    if (!stripeConnectInstance) return;
    stripeConnectInstance.update({
      appearance: {
        variables: appearanceVariablesForTheme(resolvedTheme),
      },
    });
  }, [resolvedTheme, stripeConnectInstance]);

  // Preview and development-environment projects do not initialize Stripe Connect.
  if (!stripeConnectInstance) {
    return <>{children}</>;
  }

  return (
    <ConnectComponentsProvider connectInstance={stripeConnectInstance}>
      {children}
    </ConnectComponentsProvider>
  );
}
