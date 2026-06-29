"use client";

import { DesignButton } from "@/components/design-components/button";
import { DesignCard } from "@/components/design-components/card";
import { Typography } from "@/components/ui";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { StripePaymentElementOptions } from "@stripe/stripe-js";
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

type CheckoutSessionSecret = {
  clientSecret?: string,
  clientSecretType?: "payment" | "setup",
};

type Props = {
  setupSubscription: () => Promise<CheckoutSessionSecret>,
  stripeAccountId: string,
  fullCode: string,
  returnUrl?: string,
  disabled?: boolean,
  chargesEnabled: boolean,
  isFree: boolean,
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
}: {
  onBypass: () => Promise<void>,
  disabled?: boolean,
}) {
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

      <DesignButton
        disabled={disabled}
        onClick={onBypass}
        className="h-11 w-full max-w-xs rounded-xl text-sm font-semibold"
      >
        Complete test purchase
      </DesignButton>
    </div>
  );
}

function buildReturnUrl(options: {
  stripeAccountId: string,
  fullCode: string,
  returnUrl?: string,
}) {
  const stripeReturnUrl = new URL(`/purchase/return`, window.location.origin);
  stripeReturnUrl.searchParams.set("stripe_account_id", options.stripeAccountId);
  stripeReturnUrl.searchParams.set("purchase_full_code", options.fullCode);
  if (options.returnUrl) {
    stripeReturnUrl.searchParams.set("return_url", options.returnUrl);
  }
  return stripeReturnUrl;
}

function FreeCheckoutForm({
  setupSubscription,
  stripeAccountId,
  fullCode,
  returnUrl,
  disabled,
  chargesEnabled,
}: Omit<Props, "isFree">) {
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    const sessionSecret = await setupSubscription();
    if (sessionSecret.clientSecret) {
      setMessage("An unexpected error occurred.");
      return;
    }
    const stripeReturnUrl = buildReturnUrl({ stripeAccountId, fullCode, returnUrl });
    stripeReturnUrl.searchParams.set("free", "1");
    window.location.assign(stripeReturnUrl.toString());
  };

  return (
    <DesignCard glassmorphic contentClassName="space-y-5 p-5 sm:p-6">
      <DesignButton
        disabled={disabled || !chargesEnabled}
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

function StripeCheckoutForm({
  setupSubscription,
  stripeAccountId,
  fullCode,
  returnUrl,
  disabled,
  chargesEnabled,
}: Omit<Props, "isFree">) {
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

    const sessionSecret = await setupSubscription();
    const stripeReturnUrl = buildReturnUrl({ stripeAccountId, fullCode, returnUrl });

    if (!sessionSecret.clientSecret) {
      setMessage("An unexpected error occurred.");
      return;
    }
    const confirmationResult = sessionSecret.clientSecretType === "setup"
      ? await stripe.confirmSetup({
        elements,
        clientSecret: sessionSecret.clientSecret,
        confirmParams: {
          return_url: stripeReturnUrl.toString(),
        },
      })
      : await stripe.confirmPayment({
        elements,
        clientSecret: sessionSecret.clientSecret,
        confirmParams: {
          return_url: stripeReturnUrl.toString(),
        },
      });
    const error = confirmationResult.error;

    if (error.type === "card_error" || error.type === "validation_error") {
      setMessage(error.message ?? "An unexpected error occurred.");
    } else {
      setMessage("An unexpected error occurred.");
    }
  };

  if (!chargesEnabled) {
    return <PaymentsNotEnabledCard />;
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

export function CheckoutForm(props: Props) {
  if (!props.chargesEnabled) {
    return <PaymentsNotEnabledCard />;
  }
  if (props.isFree) {
    return <FreeCheckoutForm {...props} />;
  }
  return <StripeCheckoutForm {...props} />;
}
