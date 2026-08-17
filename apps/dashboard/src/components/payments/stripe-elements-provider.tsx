"use client";
import { getPublicEnvVar } from "@/lib/env";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useTheme } from "@/lib/theme";
import { useMemo } from "react";
import { appearanceVariablesForTheme } from "./stripe-theme-variables";

const stripePublicKey = getPublicEnvVar("NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY");

type StripeElementsProviderProps = {
  children: React.ReactNode,
  stripeAccountId: string,
  amount: number,
  mode?: "subscription" | "payment" | "setup",
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

  const appearance = {
    variables: appearanceVariablesForTheme(resolvedTheme),
    labels: "floating" as const,
  };

  // Remount when mode changes — Stripe Elements options.mode is not safely
  // updated in place; free-trial checkout switches to setup after validate-code.
  return (
    <Elements
      key={`${mode}:${stripeAccountId}:${amount}`}
      stripe={stripePromise}
      options={mode === "setup"
        ? {
          mode: "setup",
          currency: "usd",
          // Restrict to cards for trial SetupIntents. Auto wallets (Apple/Google
          // Pay) can 400 elements/sessions on local HTTP / incomplete Connect
          // capability setups and surface as a generic Elements error.
          paymentMethodTypes: ["card"],
          appearance,
        }
        : {
          mode,
          currency: "usd",
          amount,
          appearance,
        }}
    >
      {children}
    </Elements>
  );
}
