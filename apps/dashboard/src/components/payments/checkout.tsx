import React, { useState } from "react";
import {
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { StripePaymentElementOptions } from "@stripe/stripe-js";
import { Button } from "@stackframe/stack-ui";

const paymentElementOptions = {
  layout: "auto",
  defaultValues: {
  },
  wallets: {
    applePay: "auto",
    googlePay: "auto",
  },
} satisfies StripePaymentElementOptions;

export function CheckoutForm({ setupSubscription }: { setupSubscription: () => Promise<string> }) {
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
    const { error } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: {
        return_url: new URL(`/purchase/return`, window.location.origin).toString(),
      },
    });


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
        disabled={!stripe || !elements}
        onClick={handleSubmit}
      >
        Submit
      </Button>
      {message && <div className="text-destructive">{message}</div>}
    </div>
  );
}
