'use client';

import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionDialog, Button, Skeleton, Typography } from "@stackframe/stack-ui";
import { loadStripe } from "@stripe/stripe-js";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import React, { useMemo, useState } from "react";
import { useStackApp } from "../../..";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";

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
  id: string,
  useBilling: () => CustomerBilling,
  useProducts: () => Array<{
    id: string | null,
    quantity: number,
    displayName: string,
    customerType: "user" | "team" | "custom",
    type: "one_time" | "subscription",
    subscription: null | {
      currentPeriodEnd: Date | null,
      cancelAtPeriodEnd: boolean,
      isCancelable: boolean,
    },
  }>,
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
  customerType?: "user" | "team",
  mockMode?: boolean,
}) {
  if (props.mockMode) {
    return <MockPaymentsPanel title={props.title} />;
  }
  if (!props.customer) {
    return null;
  }
  return <RealPaymentsPanel title={props.title} customer={props.customer} customerType={props.customerType ?? "user"} />;
}

function MockPaymentsPanel(props: { title?: string }) {
  const { t } = useTranslation();
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
        title={t("Payment method")}
        description={t("Manage the default payment method used for subscriptions and invoices.")}
      >
        <Typography>{formatPaymentMethod(defaultPaymentMethod)}</Typography>
        <Button disabled>
          {t("Update payment method")}
        </Button>
      </Section>

      <Section
        title={t("Active plans")}
        description={t("View your active plans and purchases.")}
      >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Typography className="truncate">{t("Pro")}</Typography>
              <Typography variant="secondary" type="footnote">{t("Renews on")} Jan 1, 2030</Typography>
            </div>
            <Button disabled variant="secondary" color="neutral">
              {t("Cancel subscription")}
            </Button>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Typography className="truncate">{t("Credits pack")}</Typography>
              <Typography variant="secondary" type="footnote">{t("One-time purchase")}</Typography>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function RealPaymentsPanel(props: { title?: string, customer: CustomerLike, customerType: "user" | "team" }) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const billing = props.customer.useBilling();
  const defaultPaymentMethod = billing.defaultPaymentMethod;
  const products = props.customer.useProducts();
  const productsForCustomerType = products.filter(product => product.customerType === props.customerType);

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [setupIntentClientSecret, setSetupIntentClientSecret] = useState<string | null>(null);
  const [setupIntentStripeAccountId, setSetupIntentStripeAccountId] = useState<string | null>(null);
  const [cancelProductId, setCancelProductId] = useState<string | null>(null);

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

      {defaultPaymentMethod && (
        <Section
          title={t("Payment method")}
          description={t("Manage the default payment method used for subscriptions and invoices.")}
        >
          <Typography>{formatPaymentMethod(defaultPaymentMethod)}</Typography>

          <Button onClick={openPaymentDialog}>
            {t("Update payment method")}
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
            title={t("Update payment method")}
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
      )}

      <Section
        title={t("Active plans")}
        description={t("View your active plans and purchases.")}
      >
        {productsForCustomerType.length === 0 ? (
          <Typography variant="secondary" type="footnote">{t("No active plans.")}</Typography>
        ) : (
          <div className="space-y-3">
            {productsForCustomerType.map((product, index) => {
              const quantitySuffix = product.quantity !== 1 ? ` ×${product.quantity}` : "";
              const isSubscription = product.type === "subscription";
              const isCancelable = isSubscription && !!product.id && !!product.subscription?.isCancelable;
              const renewsAt = isSubscription ? (product.subscription?.currentPeriodEnd ?? null) : null;

              const subtitle =
                product.type === "one_time"
                  ? t("One-time purchase")
                  : renewsAt
                    ? `${t("Renews on")} ${new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(renewsAt)}`
                    : t("Subscription");

              return (
                <div key={product.id ?? `${product.displayName}-${index}`} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Typography className="truncate">{product.displayName}{quantitySuffix}</Typography>
                    <Typography variant="secondary" type="footnote">{subtitle}</Typography>
                  </div>

                  {isCancelable && (
                    <Button
                      variant="secondary"
                      color="neutral"
                      onClick={() => setCancelProductId(product.id)}
                    >
                      {t("Cancel subscription")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <ActionDialog
          open={cancelProductId !== null}
          onOpenChange={(open) => {
            if (!open) setCancelProductId(null);
          }}
          title={t("Cancel subscription")}
          description={t("Canceling will stop future renewals for this subscription.")}
          danger
          cancelButton
          okButton={{
            label: t("Cancel subscription"),
            onClick: async () => {
              const productId = cancelProductId;
              if (!productId) return;
              if (props.customerType === "team") {
                await stackApp.cancelSubscription({ teamId: props.customer.id, productId });
              } else {
                await stackApp.cancelSubscription({ productId });
              }
              setCancelProductId(null);
            },
          }}
        />
      </Section>
    </div>
  );
}
