import { Button } from "@stackframe/stack-ui";
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
  disabled?: boolean,
};

export function CheckoutForm({ setupSubscription, stripeAccountId, fullCode, disabled }: Props) {
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
    const returnUrl = new URL(`/purchase/return`, window.location.origin);
    returnUrl.searchParams.set("stripe_account_id", stripeAccountId);
    returnUrl.searchParams.set("purchase_full_code", fullCode);

    const { error } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: {
        return_url: returnUrl.toString(),
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

  return (
    <div className="flex flex-col gap-6 max-w-md w-full p-6 rounded-md bg-background">
      <PaymentElement options={paymentElementOptions} />
      <Button
        disabled={!stripe || !elements || disabled}
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
