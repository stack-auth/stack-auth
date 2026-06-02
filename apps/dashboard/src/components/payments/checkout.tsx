"use client";

import { DesignButton } from "@/components/design-components/button";
import { DesignCard } from "@/components/design-components/card";
import { Typography } from "@/components/ui";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { StripeError, StripePaymentElementOptions } from "@stripe/stripe-js";
import { FlaskIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";

const paymentElementOptions = {
  layout: "auto",
  defaultValues: {
  },
  wallets: {
    applePay: "auto",
    googlePay: "auto",
  },
} satisfies StripePaymentElementOptions;

type Props = {
  setupSubscription: () => Promise<string>,
  stripeAccountId: string,
  fullCode: string,
  returnUrl?: string,
  disabled?: boolean,
  onTestModeBypass?: () => Promise<void>,
  chargesEnabled: boolean,
  isFree: boolean,
};

export function CheckoutForm({
  setupSubscription,
  stripeAccountId,
  fullCode,
  returnUrl,
  disabled,
  onTestModeBypass,
  chargesEnabled,
  isFree,
}: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!stripe || !elements) {
      return;
    }
    const { error: submitError } = await elements.submit();
    if (submitError) {
      return setMessage(submitError.message ?? "An unexpected error occurred.");
    }

    const clientSecret = await setupSubscription();
    const stripeReturnUrl = new URL(`/purchase/return`, window.location.origin);
    stripeReturnUrl.searchParams.set("stripe_account_id", stripeAccountId);
    stripeReturnUrl.searchParams.set("purchase_full_code", fullCode);
    if (returnUrl) {
      stripeReturnUrl.searchParams.set("return_url", returnUrl);
    }

    if (isFree) {
      // $0 subs: backend creates the Stripe subscription synchronously and
      // returns no client_secret (nothing to confirm). Skip Stripe Elements
      // and route through /purchase/return with `free=1` so the return page
      // renders a terminal success state instead of waiting on a Stripe
      // PaymentIntent that will never exist. The return page handles the
      // `return_url` bounce (or shows the success page when none was given).
      stripeReturnUrl.searchParams.set("free", "1");
      window.location.assign(stripeReturnUrl.toString());
      return;
    }
    const { error } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: {
        return_url: stripeReturnUrl.toString(),
      },
    }) as { error?: StripeError };

    if (!error) {
      return;
    }
    if (error.type === "card_error" || error.type === "validation_error") {
      setMessage(error.message ?? "An unexpected error occurred.");
    } else {
      setMessage("An unexpected error occurred.");
    }
  };

  if (onTestModeBypass) {
    return (
      <div className="flex flex-col items-center justify-center text-center space-y-6 py-8">
        {/* Centered Beaker Icon */}
        <div className="flex size-12 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.05)]">
          <FlaskIcon className="size-5" weight="fill" />
        </div>

        {/* Text Details */}
        <div className="space-y-2 max-w-xs">
          <Typography type="h3" className="text-lg font-semibold text-foreground">
            Test mode active
          </Typography>
          <Typography type="p" variant="secondary" className="text-sm text-muted-foreground leading-relaxed">
            This project is in test mode. Use the bypass button to simulate a purchase.
          </Typography>
        </div>

        {/* Centered Action Button */}
        <DesignButton
          disabled={disabled}
          onClick={onTestModeBypass}
          className="w-full max-w-xs h-11 text-sm font-semibold rounded-xl"
        >
          Complete test purchase
        </DesignButton>

        {message && (
          <Typography type="p" variant="destructive" className="text-sm">
            {message}
          </Typography>
        )}
      </div>
    );
  }

  if (!chargesEnabled) {
    return (
      <DesignCard glassmorphic contentClassName="space-y-4 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <WarningCircleIcon className="size-4" weight="fill" />
          </div>
          <div className="space-y-1">
            <Typography type="h3" className="text-base font-semibold text-destructive">
              Payments not enabled
            </Typography>
            <Typography type="p" variant="secondary" className="text-sm">
              This project does not have payments enabled yet. Please contact the app developer to finish setting up payments.
            </Typography>
          </div>
        </div>
      </DesignCard>
    );
  }

  return (
    <DesignCard glassmorphic contentClassName="space-y-5 p-5 sm:p-6">
      <PaymentElement options={paymentElementOptions} />
      <DesignButton
        disabled={!stripe || !elements || disabled || !chargesEnabled}
        onClick={handleSubmit}
        className="w-full"
      >
        Submit
      </DesignButton>
      {message && (
        <Typography type="p" variant="destructive" className="text-sm">
          {message}
        </Typography>
      )}
    </DesignCard>
  );
}
