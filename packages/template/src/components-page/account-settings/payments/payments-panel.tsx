'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { ActionDialog, Button, Input, Label, Skeleton, Typography } from "@stackframe/stack-ui";
import { loadStripe } from "@stripe/stripe-js";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Section } from "../section";
import * as yup from "yup";

type BillingDetails = {
  name: string | null,
  email: string | null,
  phone: string | null,
  address: {
    line1: string | null,
    line2: string | null,
    city: string | null,
    state: string | null,
    postal_code: string | null,
    country: string | null,
  } | null,
};

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
  billingDetails: BillingDetails,
  defaultPaymentMethod: PaymentMethodSummary,
};

type CustomerPaymentMethodSetupIntent = {
  clientSecret: string,
  stripeAccountId: string,
};

type CustomerLike = {
  useBilling: () => CustomerBilling,
  updateBilling: (update: {
    name?: string,
    email?: string,
    phone?: string,
    address?: {
      line1?: string,
      line2?: string,
      city?: string,
      state?: string,
      postal_code?: string,
      country?: string,
    },
  }) => Promise<void>,
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
  title: string,
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

function MockPaymentsPanel(props: { title: string }) {
  const billingDetails: BillingDetails = {
    name: "Mock User",
    email: "mock@example.com",
    phone: null,
    address: null,
  };
  const defaultPaymentMethod: PaymentMethodSummary = {
    id: "pm_mock",
    brand: "visa",
    last4: "4242",
    exp_month: 12,
    exp_year: 2030,
  };

  return (
    <div className="space-y-4">
      <Typography className="font-medium">{props.title}</Typography>
      <Section
        title="Billing information"
        description="Update invoice billing details for this customer."
      >
        <Typography variant="secondary" type="footnote">
          Billing editing is disabled in mock mode.
        </Typography>
        <Typography variant="secondary" type="footnote">
          {billingDetails.email}
        </Typography>
      </Section>
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

function RealPaymentsPanel(props: { title: string, customer: CustomerLike }) {
  const billing = props.customer.useBilling();
  const billingDetails = billing.billingDetails;
  const defaultPaymentMethod = billing.defaultPaymentMethod;

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [setupIntentClientSecret, setSetupIntentClientSecret] = useState<string | null>(null);
  const [setupIntentStripeAccountId, setSetupIntentStripeAccountId] = useState<string | null>(null);

  const billingSchema = useMemo(() => yupObject({
    name: yupString().optional().default(undefined),
    email: yupString().optional().default(undefined),
    phone: yupString().optional().default(undefined),
    address_line1: yupString().optional().default(undefined),
    address_line2: yupString().optional().default(undefined),
    address_city: yupString().optional().default(undefined),
    address_state: yupString().optional().default(undefined),
    address_postal_code: yupString().optional().default(undefined),
    address_country: yupString().optional().default(undefined),
  }), []);

  const { register, handleSubmit, reset } = useForm<yup.InferType<typeof billingSchema>>({
    resolver: yupResolver(billingSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      address_line1: "",
      address_line2: "",
      address_city: "",
      address_state: "",
      address_postal_code: "",
      address_country: "",
    },
  });

  const billingFormValues = useMemo(() => ({
    name: billingDetails.name ?? "",
    email: billingDetails.email ?? "",
    phone: billingDetails.phone ?? "",
    address_line1: billingDetails.address?.line1 ?? "",
    address_line2: billingDetails.address?.line2 ?? "",
    address_city: billingDetails.address?.city ?? "",
    address_state: billingDetails.address?.state ?? "",
    address_postal_code: billingDetails.address?.postal_code ?? "",
    address_country: billingDetails.address?.country ?? "",
  }), [
    billingDetails.name,
    billingDetails.email,
    billingDetails.phone,
    billingDetails.address?.line1,
    billingDetails.address?.line2,
    billingDetails.address?.city,
    billingDetails.address?.state,
    billingDetails.address?.postal_code,
    billingDetails.address?.country,
  ]);

  const lastAppliedBillingKeyRef = useRef<string | null>(null);
  const billingKey = useMemo(() => JSON.stringify(billingFormValues), [billingFormValues]);

  useEffect(() => {
    if (lastAppliedBillingKeyRef.current === billingKey) {
      return;
    }
    lastAppliedBillingKeyRef.current = billingKey;
    reset(billingFormValues);
  }, [billingFormValues, billingKey, reset]);

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
      <Typography className="font-medium">{props.title}</Typography>

      <Section
        title="Billing information"
        description="Update invoice billing details for this customer."
      >
        <form
          onSubmit={(e) => runAsynchronouslyWithAlert(handleSubmit(async (data) => {
            const address = {
              line1: data.address_line1 || undefined,
              line2: data.address_line2 || undefined,
              city: data.address_city || undefined,
              state: data.address_state || undefined,
              postal_code: data.address_postal_code || undefined,
              country: data.address_country || undefined,
            };

            await props.customer.updateBilling({
              name: data.name || undefined,
              email: data.email || undefined,
              phone: data.phone || undefined,
              address,
            });
          })(e))}
          className="space-y-3"
        >
          <div className="space-y-2">
            <Label htmlFor="billing-name">Name / Company</Label>
            <Input id="billing-name" {...register("name")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="billing-email">Billing email</Label>
            <Input id="billing-email" {...register("email")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="billing-phone">Phone</Label>
            <Input id="billing-phone" {...register("phone")} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="billing-line1">Address line 1</Label>
              <Input id="billing-line1" {...register("address_line1")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="billing-line2">Address line 2</Label>
              <Input id="billing-line2" {...register("address_line2")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="billing-city">City</Label>
              <Input id="billing-city" {...register("address_city")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="billing-state">State / Province</Label>
              <Input id="billing-state" {...register("address_state")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="billing-postal">Postal code</Label>
              <Input id="billing-postal" {...register("address_postal_code")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="billing-country">Country</Label>
              <Input id="billing-country" {...register("address_country")} />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" className="mr-0 ml-auto">
              Save billing info
            </Button>
          </div>
        </form>
      </Section>

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
