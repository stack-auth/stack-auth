"use client";

import { DesignButton } from "@/components/design-components/button";
import { DesignAlert } from "@/components/design-components/alert";
import { DesignCard } from "@/components/design-components/card";
import { Typography } from "@/components/ui";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Result } from "@hexclave/shared/dist/utils/results";
import { StripePaymentElementOptions } from "@stripe/stripe-js";
import { FlaskIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";

const paymentElementOptionsWithWallets = {
  layout: "auto",
  defaultValues: {
  },
  wallets: {
    applePay: "auto",
    googlePay: "auto",
  },
} satisfies StripePaymentElementOptions;

const paymentElementOptionsCardsOnly = {
  layout: "auto",
  defaultValues: {
  },
  wallets: {
    applePay: "never",
    googlePay: "never",
  },
} satisfies StripePaymentElementOptions;

function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallbackMessage;
}

function getStripeConfirmationError(result: unknown) {
  if (typeof result !== "object" || result === null || !("error" in result)) {
    return null;
  }
  const error = result.error;
  if (typeof error !== "object" || error === null) {
    return null;
  }
  return {
    type: "type" in error && typeof error.type === "string" ? error.type : null,
    message: "message" in error && typeof error.message === "string" ? error.message : null,
    code: "code" in error && typeof error.code === "string" ? error.code : null,
  };
}

type Props = {
  setupSubscription: () => Promise<{ clientSecret: string, stripeIntentType: "payment" | "setup" } | null>,
  stripeAccountId: string,
  fullCode: string,
  returnUrl?: string,
  disabled?: boolean,
  chargesEnabled: boolean,
  isFree: boolean,
  /**
   * When true, Payment Element is collecting a SetupIntent (free trial). Disable
   * wallet buttons — they often 400 elements/sessions for setup mode on Connect.
   */
  setupMode?: boolean,
};

export function PaymentsNotEnabledCard() {
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

export function TestModeBypassForm({
  onBypass,
  disabled,
  ignoresFreeTrial,
}: {
  onBypass: () => Promise<void>,
  disabled?: boolean,
  /**
   * When the selected product/price has a free trial configured, test mode
   * still grants access immediately (no Stripe trial). Surface that so buyers
   * don't think the trial path was exercised.
   */
  ignoresFreeTrial?: boolean,
}) {
  const [bypassError, setBypassError] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);

  const handleBypass = async () => {
    setBypassError(null);
    setIsCompleting(true);
    const result = await Result.fromPromise(onBypass());
    if (result.status === "error") {
      setBypassError(getErrorMessage(result.error, "We couldn't complete the test purchase. Please try again."));
    }
    setIsCompleting(false);
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.05)]">
        <FlaskIcon className="size-5" weight="fill" />
      </div>

      <div className="max-w-xs space-y-2">
        <Typography type="h3" className="text-lg font-semibold text-foreground">
          Test mode active
        </Typography>
        <Typography type="p" variant="secondary" className="text-sm leading-relaxed text-muted-foreground">
          This project is in test mode. Use the bypass button to simulate a purchase.
        </Typography>
      </div>

      {ignoresFreeTrial === true && (
        <DesignAlert
          variant="warning"
          title="Free trial skipped in test mode"
          description="Test mode grants the product immediately. It does not create a free trial or defer the first charge. Turn off test mode to exercise the real free-trial checkout."
          className="w-full max-w-xs text-left"
        />
      )}

      <DesignButton
        disabled={disabled || isCompleting}
        loading={isCompleting}
        onClick={handleBypass}
        className="h-11 w-full max-w-xs rounded-xl text-sm font-semibold"
      >
        Complete test purchase
      </DesignButton>
      {bypassError && (
        <DesignAlert
          variant="error"
          title="Could not complete test purchase"
          description={bypassError}
          className="w-full max-w-xs text-left"
        />
      )}
    </div>
  );
}

export function CheckoutForm({
  setupSubscription,
  stripeAccountId,
  fullCode,
  returnUrl,
  disabled,
  chargesEnabled,
  isFree,
  setupMode = false,
}: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!isFree && (!stripe || !elements)) {
      return;
    }
    setMessage(null);

    const stripeReturnUrl = new URL(`/purchase/return`, window.location.origin);
    stripeReturnUrl.searchParams.set("stripe_account_id", stripeAccountId);
    stripeReturnUrl.searchParams.set("purchase_full_code", fullCode);
    if (returnUrl) {
      stripeReturnUrl.searchParams.set("return_url", returnUrl);
    }

    if (isFree) {
      const setupResult = await Result.fromPromise(setupSubscription());
      if (setupResult.status === "error") {
        setMessage(getErrorMessage(setupResult.error, "We couldn't complete the purchase. Please try again."));
        return;
      }
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

    if (!stripe || !elements) {
      return;
    }
    const activeStripe = stripe;
    const activeElements = elements;

    const submitResult = await Result.fromPromise(activeElements.submit());
    if (submitResult.status === "error") {
      setMessage(getErrorMessage(submitResult.error, "An unexpected error occurred."));
      return;
    }
    const { error: submitError } = submitResult.data;
    if (submitError) {
      setMessage(submitError.message ?? "An unexpected error occurred.");
      return;
    }

    const setupResult = await Result.fromPromise(setupSubscription());
    if (setupResult.status === "error") {
      setMessage(getErrorMessage(setupResult.error, "We couldn't complete the purchase. Please try again."));
      return;
    }
    const setupData = setupResult.data;

    if (setupData == null) {
      setMessage("We couldn't complete the purchase. Please try again.");
      return;
    }
    // Free trials return a SetupIntent (seti_…) so we collect a card without
    // charging; paid starts return a PaymentIntent (pi_…). confirmPayment on a
    // setup secret fails with "No such payment_intent".
    const confirmResult = await Result.fromPromise(
      setupData.stripeIntentType === "setup"
        ? activeStripe.confirmSetup({
          elements: activeElements,
          clientSecret: setupData.clientSecret,
          confirmParams: {
            return_url: stripeReturnUrl.toString(),
          },
        })
        : activeStripe.confirmPayment({
          elements: activeElements,
          clientSecret: setupData.clientSecret,
          confirmParams: {
            return_url: stripeReturnUrl.toString(),
          },
        })
    );
    if (confirmResult.status === "error") {
      setMessage(getErrorMessage(confirmResult.error, "An unexpected error occurred."));
      return;
    }
    const error = getStripeConfirmationError(confirmResult.data);

    if (error == null) {
      return;
    }
    // Always surface Stripe's message — invalid_request_error / mode mismatches
    // used to collapse to a useless "unexpected error" and hide the real cause.
    setMessage(error.message ?? "An unexpected error occurred.");
  };

  if (!chargesEnabled) {
    return <PaymentsNotEnabledCard />;
  }

  return (
    <DesignCard glassmorphic contentClassName="space-y-5 p-5 sm:p-6">
      {!isFree && (
        <PaymentElement
          options={setupMode ? paymentElementOptionsCardsOnly : paymentElementOptionsWithWallets}
          onLoadError={(event) => {
            const loadMessage = event.error.message;
            setMessage(loadMessage != null && loadMessage !== "" ? loadMessage : "Stripe payment form failed to load.");
          }}
        />
      )}
      <DesignButton
        disabled={(!isFree && (!stripe || !elements)) || disabled || !chargesEnabled}
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
