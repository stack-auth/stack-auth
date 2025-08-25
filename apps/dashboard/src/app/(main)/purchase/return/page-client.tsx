"use client";

import { StyledLink } from "@/components/link";
import { getPublicEnvVar } from "@/lib/env";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Typography } from "@stackframe/stack-ui";
import { loadStripe } from "@stripe/stripe-js";
import { useCallback, useEffect, useState } from "react";

type Props = {
  redirectStatus?: string,
  paymentIntentId?: string,
  clientSecret?: string,
  stripeAccountId?: string,
  purchaseFullCode?: string,
  bypass?: string,
};

type ViewState =
  | { kind: "loading" }
  | { kind: "success", message: string }
  | { kind: "error", message: string };

const stripePublicKey = getPublicEnvVar("NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY") ?? "";

export default function ReturnClient({ clientSecret, stripeAccountId, purchaseFullCode, bypass }: Props) {
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  const updateViewState = useCallback(async (): Promise<void> => {
    try {
      if (bypass === "1") {
        setState({ kind: "success", message: "Bypassed in test mode. No payment processed." });
        return;
      }
      const stripe = await loadStripe(stripePublicKey, { stripeAccount: stripeAccountId });
      if (!stripe) throw new Error("Stripe failed to initialize");
      if (!clientSecret) return;
      const result = await stripe.retrievePaymentIntent(clientSecret);
      const status = result.paymentIntent?.status;
      const lastErrorMessage = result.paymentIntent?.last_payment_error?.message;

      if (status === "succeeded") {
        setState({ kind: "success", message: "Payment succeeded. You can close this page." });
        return;
      }
      if (status === "processing") {
        setState({ kind: "success", message: "Payment is processing. You'll receive an update shortly." });
        return;
      }
      if (status === "requires_payment_method") {
        setState({ kind: "error", message: lastErrorMessage ?? "Payment failed. Please try another payment method." });
        return;
      }
      if (status === "requires_action") {
        setState({ kind: "error", message: "Additional authentication required. Please try again." });
        return;
      }
      if (status === "canceled") {
        setState({ kind: "error", message: "Payment was canceled." });
        return;
      }
      setState({ kind: "error", message: "Unexpected payment state." });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unexpected error retrieving payment.";
      setState({ kind: "error", message });
    }
  }, [clientSecret, stripeAccountId, bypass]);

  useEffect(() => {
    runAsynchronously(updateViewState());
  }, [updateViewState]);

  return (
    <div className="flex flex-col items-center justify-center h-screen text-center px-4 gap-4">
      {state.kind === "loading" && (
        <>
          <Typography type="h2">Finalizing purchase…</Typography>
          <Typography type="label">Please wait while we verify your payment.</Typography>
        </>
      )}
      {state.kind === "success" && (
        <>
          <Typography type="h2">Purchase successful</Typography>
          <Typography type="label">{state.message}</Typography>
        </>
      )}
      {state.kind === "error" && (
        <>
          <Typography type="h2">Purchase failed</Typography>
          <Typography type="label">
            The following error occurred: &quot;{state.message}&quot;
          </Typography>
          <Typography type="label">
            <StyledLink href={`/purchase/${purchaseFullCode}`}>Click here</StyledLink> to try making your purchase again.
          </Typography>
        </>
      )}
    </div>
  );
}

