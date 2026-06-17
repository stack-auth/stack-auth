"use client";

import { StyledLink } from "@/components/link";
import { DesignCard } from "@/components/design-components/card";
import { Typography } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { CheckCircleIcon, SpinnerGapIcon, XCircleIcon } from "@phosphor-icons/react";
import { loadStripe } from "@stripe/stripe-js";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Props = {
  redirectStatus?: string,
  paymentIntentId?: string,
  clientSecret?: string,
  stripeAccountId?: string,
  purchaseFullCode?: string,
  bypass?: string,
  free?: string,
};

type ViewState =
  | { kind: "loading" }
  | { kind: "success", message: string }
  | { kind: "error", message: string };

const stripePublicKey = getPublicEnvVar("NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY") ?? "";
const apiUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_STACK_API_URL is not set");
const baseUrl = new URL("/api/v1", apiUrl).toString();

export default function ReturnClient({ clientSecret, stripeAccountId, purchaseFullCode, bypass, free }: Props) {
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("return_url");

  const checkAndReturnUser = useCallback(async () => {
    if (!returnUrl || !purchaseFullCode) {
      return;
    }
    const url = new URL(`${baseUrl}/payments/purchases/validate-code`);
    url.searchParams.set("full_code", purchaseFullCode);
    url.searchParams.set("return_url", returnUrl);
    const response = await fetch(url);
    if (response.ok) {
      window.location.assign(returnUrl);
    }
  }, [returnUrl, purchaseFullCode]);

  const updateViewState = useCallback(async (): Promise<void> => {
    try {
      if (bypass === "1") {
        runAsynchronously(checkAndReturnUser());
        const message = `Bypassed in test mode. No payment processed.${returnUrl ? " You will be redirected shortly." : ""}`;
        setState({ kind: "success", message });
        return;
      }
      if (free === "1") {
        // $0 subs activate synchronously on the Stripe side and produce no
        // PaymentIntent / client_secret, so there's nothing to retrieve —
        // mirror the bypass branch and show terminal success.
        runAsynchronously(checkAndReturnUser());
        const message = `Free subscription activated. No payment required.${returnUrl ? " You will be redirected shortly." : ""}`;
        setState({ kind: "success", message });
        return;
      }
      const stripe = await loadStripe(stripePublicKey, { stripeAccount: stripeAccountId });
      if (!stripe) throw new Error("Stripe failed to initialize");
      if (!clientSecret) return;
      const result = await stripe.retrievePaymentIntent(clientSecret);
      const status = result.paymentIntent?.status;
      const lastErrorMessage = result.paymentIntent?.last_payment_error?.message;

      if (status === "succeeded") {
        runAsynchronously(checkAndReturnUser());
        const message = `Payment succeeded.${returnUrl ? " You will be redirected shortly." : " You can safely close this page."}`;
        setState({ kind: "success", message });
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
  }, [clientSecret, stripeAccountId, bypass, free, returnUrl, checkAndReturnUser]);

  useEffect(() => {
    runAsynchronously(updateViewState());
  }, [updateViewState]);

  return (
    <div data-hexclave-purchase-page className="relative flex min-h-screen items-center justify-center bg-white px-4 py-12 dark:bg-black">
      <DesignCard glassmorphic className="relative w-full max-w-md" contentClassName="flex flex-col items-center gap-5 p-8 text-center">
        {state.kind === "loading" && (
          <>
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
              <SpinnerGapIcon className="size-7 animate-spin text-primary" />
            </div>
            <Typography type="h2" className="text-xl font-semibold tracking-tight">
              Finalizing purchase…
            </Typography>
            <Typography type="label" className="text-sm text-muted-foreground">
              Please wait while we verify your payment.
            </Typography>
          </>
        )}

        {state.kind === "success" && (
          <>
            <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircleIcon className="size-7 text-emerald-600 dark:text-emerald-400" weight="fill" />
            </div>
            <Typography type="h2" className="text-xl font-semibold tracking-tight">
              Purchase successful
            </Typography>
            <Typography type="label" className="text-sm text-muted-foreground">
              {state.message}
            </Typography>
          </>
        )}

        {state.kind === "error" && (
          <>
            <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10">
              <XCircleIcon className="size-7 text-destructive" weight="fill" />
            </div>
            <Typography type="h2" className="text-xl font-semibold tracking-tight">
              Purchase failed
            </Typography>
            <Typography type="label" className="text-sm text-muted-foreground">
              The following error occurred: &quot;{state.message}&quot;
            </Typography>
            <Typography type="label" className="text-sm text-muted-foreground">
              <StyledLink href={`/purchase/${purchaseFullCode}`}>Click here</StyledLink> to try making your purchase again.
            </Typography>
          </>
        )}
      </DesignCard>
    </div>
  );
}
