"use client";
import { getPublicEnvVar } from "@/lib/env";
import { useTheme } from "next-themes";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useMemo } from "react";
import { appearanceVariablesForTheme } from "./stripe-theme-variables";

const stripePublicKey = getPublicEnvVar("NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY");

type StripeElementsProviderProps = {
  children: React.ReactNode,
  stripeAccountId: string,
  amount: number,
};

export function StripeElementsProvider({
  children,
  stripeAccountId,
  amount,
}: StripeElementsProviderProps) {
  const { resolvedTheme } = useTheme();

  const stripePromise = useMemo(() => {
    return loadStripe(stripePublicKey ?? "", { stripeAccount: stripeAccountId });
  }, [stripeAccountId]);


  return (
    <Elements
      stripe={stripePromise}
      options={{
        mode: "subscription",
        currency: "usd",
        amount,
        appearance: {
          variables: appearanceVariablesForTheme(resolvedTheme),
          labels: "floating"
        }
      }}
    >
      {children}
    </Elements>
  );
}
