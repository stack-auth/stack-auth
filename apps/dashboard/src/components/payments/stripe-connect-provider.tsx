"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { getPublicEnvVar } from "@/lib/env";
import { StackAdminApp } from "@stackframe/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import {
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { appearanceVariablesForTheme } from "./stripe-theme-variables";

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
  const { resolvedTheme } = useTheme();

  const stripeConnectInstance = getStripeConnectInstance(adminApp);

  useEffect(() => {
    stripeConnectInstance.update({
      appearance: {
        variables: appearanceVariablesForTheme(resolvedTheme),
      },
    });
  }, [resolvedTheme, stripeConnectInstance]);

  return (
    <ConnectComponentsProvider connectInstance={stripeConnectInstance}>
      {children}
    </ConnectComponentsProvider>
  );
}
