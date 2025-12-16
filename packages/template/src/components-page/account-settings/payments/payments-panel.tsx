'use client';

import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionDialog, Button, Skeleton, Typography } from "@stackframe/stack-ui";
import { loadStripe } from "@stripe/stripe-js";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import React, { useMemo, useState } from "react";
import { Section } from "../section";

type PaymentMethodSummary = {
  id: string,
  brand: string | null,
  last4: string | null,
  exp_month: number | null,
  exp_year: number | null,
} | null;

function formatPaymentMethod(pm: NonNullable<PaymentMethodSummary>) {
  const details = [
    pm.brand ? pm.brand.toUpperCase() : null,
    pm.last4 ? `•••• ${pm.last4}` : null,
    pm.exp_month && pm.exp_year ? `exp ${pm.exp_month}/${pm.exp_year}` : null,
  ].filter(Boolean);
  return details.join(" · ");
}

type CustomerBilling = {
  hasCustomer: boolean,
  defaultPaymentMethod: PaymentMethodSummary,
};

type CustomerPaymentMethodSetupIntent = {
  clientSecret: string,
  stripeAccountId: string,
};

type CustomerLike = {
  useBilling: () => CustomerBilling,
  createPaymentMethodSetupIntent: () => Promise<CustomerPaymentMethodSetupIntent>,
  setDefaultPaymentMethodFromSetupIntent: (setupIntentId: string) => Promise<PaymentMethodSummary>,
};

function SetDefaultPaymentMethodForm(props: {
  clientSecret: string,
  onSetupIntentSucceeded: (setupIntentId: string) => Promise<void>,
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const darkMode = "color-scheme" in document.documentElement.style && document.documentElement.style["color-scheme"] === "dark";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Typography className="font-medium">Card details</Typography>
        <div className="rounded-md border border-input p-3">
          <CardElement options={{ hidePostalCode: true, style: { base: { color: darkMode ? "white" : "black" } } }} />
        </div>
      </div>
      {errorMessage && (
        <Typography variant="secondary" type="footnote">
          {errorMessage}
        </Typography>
      )}
      <Button
        onClick={async () => {
          if (!stripe || !elements) {
            setErrorMessage("Stripe is still loading. Please try again.");
            return;
          }
          const card = elements.getElement(CardElement);
          if (!card) {
            setErrorMessage("Card element not found.");
            return;
          }

          const result = await stripe.confirmCardSetup(props.clientSecret, {
            payment_method: { card },
          });
          if (result.error) {
            setErrorMessage(result.error.message ?? "Failed to save payment method.");
            return;
          }
          if (!result.setupIntent.id) {
            setErrorMessage("No setup intent returned from Stripe.");
            return;
          }
          await props.onSetupIntentSucceeded(result.setupIntent.id);
        }}
      >
        Save payment method
      </Button>
    </div>
  );
}

export function PaymentsPanel(props: {
  title?: string,
  customer?: CustomerLike,
  mockMode?: boolean,
}) {
  if (props.mockMode) {
    return <MockPaymentsPanel title={props.title} />;
  }
  if (!props.customer) {
    return null;
  }
  return <RealPaymentsPanel title={props.title} customer={props.customer} />;
}

function MockPaymentsPanel(props: { title?: string }) {
  const defaultPaymentMethod: PaymentMethodSummary = {
    id: "pm_mock",
    brand: "visa",
    last4: "4242",
    exp_month: 12,
    exp_year: 2030,
  };

  return (
    <div className="space-y-4">
      {props.title && <Typography className="font-medium">{props.title}</Typography>}
      <Section
        title="Payment method"
        description="Manage the default payment method used for subscriptions and invoices."
      >
        <Typography>{formatPaymentMethod(defaultPaymentMethod)}</Typography>
        <Button disabled>
          Update payment method
        </Button>
      </Section>
    </div>
  );
}

function RealPaymentsPanel(props: { title?: string, customer: CustomerLike }) {
  const billing = props.customer.useBilling();
  const defaultPaymentMethod = billing.defaultPaymentMethod;

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [setupIntentClientSecret, setSetupIntentClientSecret] = useState<string | null>(null);
  const [setupIntentStripeAccountId, setSetupIntentStripeAccountId] = useState<string | null>(null);

  const stripePromise = useMemo(() => {
    if (!setupIntentStripeAccountId) return null;
    const publishableKey = process.env.NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) return null;
    return loadStripe(publishableKey, { stripeAccount: setupIntentStripeAccountId });
  }, [setupIntentStripeAccountId]);

  const openPaymentDialog = () => {
    runAsynchronouslyWithAlert(async () => {
      setPaymentDialogOpen(true);
      const res = await props.customer.createPaymentMethodSetupIntent();
      setSetupIntentClientSecret(res.clientSecret);
      setSetupIntentStripeAccountId(res.stripeAccountId);
    });
  };

  const closePaymentDialog = () => {
    setPaymentDialogOpen(false);
    setSetupIntentClientSecret(null);
    setSetupIntentStripeAccountId(null);
  };

  return (
    <div className="space-y-4">
      {props.title && <Typography className="font-medium">{props.title}</Typography>}

      <Section
        title="Payment method"
        description="Manage the default payment method used for subscriptions and invoices."
      >
        {defaultPaymentMethod ? (
          <Typography>{formatPaymentMethod(defaultPaymentMethod)}</Typography>
        ) : (
          <Typography variant="secondary" type="footnote">No payment method on file.</Typography>
        )}

        <Button onClick={openPaymentDialog}>
          {defaultPaymentMethod ? "Update payment method" : "Add payment method"}
        </Button>

        <ActionDialog
          open={paymentDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              closePaymentDialog();
            } else {
              setPaymentDialogOpen(true);
            }
          }}
          title="Update payment method"
        >
          {!setupIntentClientSecret || !setupIntentStripeAccountId || !stripePromise ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret: setupIntentClientSecret,
              }}
            >
              <SetDefaultPaymentMethodForm
                clientSecret={setupIntentClientSecret}
                onSetupIntentSucceeded={async (setupIntentId) => {
                  await props.customer.setDefaultPaymentMethodFromSetupIntent(setupIntentId);
                  closePaymentDialog();
                }}
              />
            </Elements>
          )}
        </ActionDialog>
      </Section>
    </div>
  );
}
