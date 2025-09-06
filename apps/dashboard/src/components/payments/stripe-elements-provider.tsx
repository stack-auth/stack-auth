"use client";
import { getPublicEnvVar } from "@/lib/env";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useTheme } from "next-themes";
import { useMemo } from "react";
import { appearanceVariablesForTheme } from "./stripe-theme-variables";

const stripePublicKey = getPublicEnvVar("NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY");

type StripeElementsProviderProps = {
  children: React.ReactNode,
  stripeAccountId: string,
  amount: number,
  mode?: "subscription" | "payment",
};

export function StripeElementsProvider({
  children,
  stripeAccountId,
  amount,
  mode = "subscription",
}: StripeElementsProviderProps) {
  const { resolvedTheme } = useTheme();

  const stripePromise = useMemo(() => {
    return loadStripe(
      stripePublicKey ?? throwErr("NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY is missing!"),
      { stripeAccount: stripeAccountId }
    );
  }, [stripeAccountId]);


  return (
    <Elements
      stripe={stripePromise}
      options={{
        mode,
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
