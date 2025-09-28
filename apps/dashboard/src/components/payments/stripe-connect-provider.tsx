"use client";

import { loadConnectAndInitialize } from "@stripe/connect-js";
import {
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";
import { useTheme } from "next-themes";
import { useEffect, useMemo } from "react";
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { getPublicEnvVar } from "@/lib/env";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { appearanceVariablesForTheme } from "./stripe-theme-variables";

type StripeConnectProviderProps = {
  children: React.ReactNode,
};

export function StripeConnectProvider({ children }: StripeConnectProviderProps) {
  const adminApp = useAdminApp();
  const { resolvedTheme } = useTheme();

  const stripeConnectInstance = useMemo(() => {
    const publishableKey = getPublicEnvVar("NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY") ?? throwErr("No Stripe publishable key found");
    const fetchClientSecret = async () => {
      const { client_secret } = await adminApp.createStripeWidgetAccountSession();
      return client_secret;
    };

    return loadConnectAndInitialize({
      publishableKey,
      fetchClientSecret,
      appearance: { overlays: 'dialog' },
    });
  }, [adminApp]);

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
