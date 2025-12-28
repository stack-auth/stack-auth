import { Button, Typography } from "@/components/ui";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { StripeError, StripePaymentElementOptions } from "@stripe/stripe-js";
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
};

export function CheckoutForm({
  setupSubscription,
  stripeAccountId,
  fullCode,
  returnUrl,
  disabled,
  onTestModeBypass,
  chargesEnabled,
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
      <div className="flex flex-col gap-4 max-w-md w-full p-6 rounded-md bg-background">
        <div className="space-y-1">
          <Typography type="h3">Test mode active</Typography>
          <p className="text-sm text-muted-foreground">
            This project is in test mode. Use the bypass button to simulate a purchase.
          </p>
        </div>
        <Button
          disabled={disabled}
          onClick={onTestModeBypass}
          className="mt-2"
        >
          Complete test purchase
        </Button>
        {message && (
          <div className="text-destructive text-sm">{message}</div>
        )}
      </div>
    );
  }

  if (!chargesEnabled) {
    return (
      <div className="flex flex-col gap-4 max-w-md w-full p-6 rounded-md bg-background">
        <div className="space-y-1">
          <Typography type="h3" variant="destructive">Payments not enabled</Typography>
          <p className="text-sm text-muted-foreground">
            This project does not have payments enabled yet. Please contact the app developer to finish setting up payments.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-md w-full p-6 rounded-md bg-background">
      <PaymentElement options={paymentElementOptions} />
      <Button
        disabled={!stripe || !elements || disabled || !chargesEnabled}
        onClick={handleSubmit}
      >
        Submit
      </Button>
      {message && (
        <div className="text-destructive">{message}</div>
      )}
    </div>
  );
}
