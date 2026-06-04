"use client";

import { CheckoutForm, PaymentsNotEnabledCard, TestModeBypassForm } from "@/components/payments/checkout";
import { PurchasePriceOption } from "@/components/payments/purchase-price-option";
import { PurchaseQuantitySelector } from "@/components/payments/purchase-quantity-selector";
import { isFreePrice, shortenedInterval } from "@/components/payments/purchase-utils";
import { StripeElementsProvider } from "@/components/payments/stripe-elements-provider";
import { DesignAlert } from "@/components/design-components/alert";
import { DesignCard } from "@/components/design-components/card";
import { Skeleton, Typography } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import { XCircleIcon } from "@phosphor-icons/react";
import { inlineProductSchema } from "@hexclave/shared/dist/schema-fields";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { typedEntries } from "@hexclave/shared/dist/utils/objects";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as yup from "yup";

type ProductData = {
  product?: Omit<yup.InferType<typeof inlineProductSchema>, "included_items" | "server_only"> & { stackable: boolean },
  stripe_account_id: string | null,
  project_id: string,
  project_logo_url: string | null,
  already_bought_non_stackable?: boolean,
  conflicting_products?: { product_id: string, display_name: string }[],
  test_mode: boolean,
  charges_enabled: boolean | null,
};

const apiUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_STACK_API_URL is not set");
const baseUrl = new URL("/api/v1", apiUrl).toString();
const MAX_STRIPE_AMOUNT_CENTS = 999_999 * 100;

export default function PageClient({ code }: { code: string }) {
  const [data, setData] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPriceId, setSelectedPriceId] = useState<string | null>(null);
  const [quantityInput, setQuantityInput] = useState<string>("1");
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("return_url");

  const quantityNumber = useMemo((): number => {
    const n = parseInt(quantityInput, 10);
    if (Number.isNaN(n)) {
      return 0;
    }
    return n;
  }, [quantityInput]);

  const unitCents = useMemo((): number => {
    if (!selectedPriceId || !data?.product?.prices) {
      return 0;
    }
    return Math.round(Number(data.product.prices[selectedPriceId].USD) * 100);
  }, [data, selectedPriceId]);

  const rawAmountCents = useMemo(() => {
    return unitCents * Math.max(0, quantityNumber);
  }, [unitCents, quantityNumber]);

  const isTooLarge = rawAmountCents > MAX_STRIPE_AMOUNT_CENTS;

  const elementsAmountCents = useMemo(() => {
    if (!unitCents) return 0;
    if (rawAmountCents < 1) return unitCents;
    if (isTooLarge) return MAX_STRIPE_AMOUNT_CENTS;
    return rawAmountCents;
  }, [unitCents, rawAmountCents, isTooLarge]);

  const elementsMode = useMemo<"subscription" | "payment">(() => {
    if (!selectedPriceId || !data?.product?.prices) return "subscription";
    const price = data.product.prices[selectedPriceId];
    return price.interval ? "subscription" : "payment";
  }, [data, selectedPriceId]);

  const validateCode = useCallback(async () => {
    const response = await fetch(`${baseUrl}/payments/purchases/validate-code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        full_code: code,
        return_url: returnUrl ?? undefined,
      }),
    });
    if (!response.ok) {
      throw new Error("Failed to validate code");
    }
    const result = await response.json();
    setData(result);
    if (result?.product?.prices) {
      const priceIds = Object.keys(result.product.prices);
      if (priceIds.length > 0) {
        setSelectedPriceId(priceIds[0]);
      }
    }
  }, [code, returnUrl]);

  useEffect(() => {
    setLoading(true);
    validateCode().catch((err) => {
      setError(err instanceof Error ? err.message : "An error occurred");
    }).finally(() => {
      setLoading(false);
    });
  }, [validateCode]);

  const isFreeSelected = useMemo<boolean>(() => {
    if (!selectedPriceId || !data?.product?.prices) return false;
    const usd = data.product.prices[selectedPriceId].USD;
    return isFreePrice(usd);
  }, [data, selectedPriceId]);

  const selectedPriceData = useMemo(() => {
    if (!selectedPriceId || !data?.product?.prices) return null;
    return data.product.prices[selectedPriceId];
  }, [data, selectedPriceId]);

  const setupSubscription = async () => {
    const response = await fetch(`${baseUrl}/payments/purchases/purchase-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_code: code, price_id: selectedPriceId, quantity: quantityNumber }),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result?.error?.message ?? "Failed to setup subscription");
    }

    if (!result.client_secret && !isFreeSelected) {
      throw new Error("Failed to setup subscription");
    }
    return result.client_secret;
  };

  const handleBypass = useCallback(async () => {
    if (quantityNumber < 1 || isTooLarge) {
      return;
    }
    const response = await fetch(`${baseUrl}/internal/payments/test-mode-purchase-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_code: code,
        price_id: selectedPriceId,
        quantity: quantityNumber,
      }),
    });
    if (!response.ok) {
      throw new Error("Failed to bypass with test mode");
    }
    const url = new URL(`/purchase/return`, window.location.origin);
    url.searchParams.set("bypass", "1");
    url.searchParams.set("purchase_full_code", code);
    if (returnUrl) {
      url.searchParams.set("return_url", returnUrl);
    }
    window.location.assign(url.toString());
  }, [code, selectedPriceId, quantityNumber, isTooLarge, returnUrl]);

  const checkoutDisabled = quantityNumber < 1 || isTooLarge || data?.already_bought_non_stackable === true;
  const showInvalidPurchaseCode = !loading && error != null;

  if (showInvalidPurchaseCode) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-white px-6 dark:bg-zinc-950">
        <div className="w-full max-w-md text-center">
          <DesignCard glassmorphic contentClassName="flex flex-col items-center gap-4 p-8">
            <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <XCircleIcon className="size-6 text-destructive" weight="fill" />
            </div>
            <div className="space-y-2">
              <Typography type="h2" className="mb-2 text-xl font-semibold text-foreground">
                Invalid Purchase Code
              </Typography>
              <Typography type="p" variant="secondary" className="text-sm">
                The purchase code is invalid or has expired. Please check your link and try again.
              </Typography>
            </div>
          </DesignCard>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-white dark:bg-zinc-950">
      <div className="relative flex min-h-screen w-full flex-col lg:flex-row">
        {/* Left Panel: Product & Pricing Selection */}
        <div className="flex flex-1 flex-col border-b border-border/40 bg-white dark:bg-zinc-950 lg:w-1/2 lg:border-b-0 lg:border-r">
          <div className="mx-auto w-full max-w-md px-6 pb-12 pt-16 lg:pt-20">
            {loading ? (
              <div className="space-y-5">
                <Skeleton className="size-12 rounded-full" />
                <Skeleton className="mt-4 h-10 w-2/3" />
                <Skeleton className="mt-2 h-5 w-full" />
                <Skeleton className="mt-8 h-20 w-full rounded-xl" />
                <Skeleton className="mt-4 h-24 w-full rounded-xl" />
              </div>
            ) : (
              <div className="space-y-8">
                {/* Product Logo */}
                {data?.project_logo_url && (
                  <div>
                    <Image
                      src={data.project_logo_url}
                      alt="Project logo"
                      className="size-12 rounded-full border border-border/40 bg-white p-1 object-contain shadow-sm dark:bg-zinc-950"
                      width={48}
                      height={48}
                      unoptimized
                    />
                  </div>
                )}

                {/* Product Name */}
                <Typography type="h1" className="text-3xl font-bold tracking-tight text-foreground">
                  {data?.product?.display_name || "Choose Your Plan"}
                </Typography>

                {/* Prominent Selected Price Display */}
                {selectedPriceData && (
                  <div className="py-2">
                    <div className="flex items-baseline gap-1">
                      <span className="text-5xl font-bold tabular-nums tracking-tight text-foreground">
                        ${selectedPriceData.USD ?? "0.00"}
                      </span>
                      {selectedPriceData.interval && (
                        <span className="text-lg font-medium text-muted-foreground">
                          /{shortenedInterval(selectedPriceData.interval)}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Conflict / Already Purchased Alerts */}
                {(data?.already_bought_non_stackable || (data?.conflicting_products && data.conflicting_products.length > 0)) && (
                  <div className="space-y-2">
                    {data.already_bought_non_stackable && (
                      <DesignAlert
                        variant="error"
                        title="Already Purchased"
                        description="You already have this product and cannot purchase it again."
                      />
                    )}
                    {data.conflicting_products && data.conflicting_products.length > 0 && (
                      <DesignAlert
                        variant="warning"
                        title="Plan Change Detected"
                        description={
                          data.conflicting_products.length === 1
                            ? `This purchase will replace your current plan: ${data.conflicting_products[0].display_name}`
                            : "This purchase will replace one of your existing plans."
                        }
                      />
                    )}
                  </div>
                )}

                {/* Pricing Options */}
                {data?.product?.prices && typedEntries(data.product.prices).length > 0 && (
                  <div className="space-y-3">
                    <Typography type="label" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Select a Pricing Option
                    </Typography>
                    <div className="grid gap-2.5">
                      {typedEntries(data.product.prices).map(([priceId, priceData]) => (
                        <PurchasePriceOption
                          key={priceId}
                          priceId={priceId}
                          priceData={priceData}
                          selected={selectedPriceId === priceId}
                          onSelect={setSelectedPriceId}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Stackable Quantity Selector */}
                {data?.product?.stackable && selectedPriceId && (
                  <div className="rounded-xl border border-border/40 bg-foreground/[0.01] p-4 sm:p-5">
                    <PurchaseQuantitySelector
                      quantityInput={quantityInput}
                      quantityNumber={quantityNumber}
                      onQuantityChange={setQuantityInput}
                      isTooLarge={isTooLarge}
                      selectedPriceId={selectedPriceId}
                      priceData={data.product.prices[selectedPriceId]}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Checkout Form / Payment Details */}
        <div className="flex flex-1 flex-col justify-center bg-zinc-200 dark:bg-black lg:w-1/2">
          <div className="mx-auto w-full max-w-md px-6 py-12">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-64 w-full rounded-2xl" />
              </div>
            ) : data ? (
              <div className="space-y-4">
                {data.test_mode ? (
                  <TestModeBypassForm
                    onBypass={handleBypass}
                    disabled={checkoutDisabled}
                  />
                ) : data.stripe_account_id == null ? (
                  <PaymentsNotEnabledCard />
                ) : (
                  <StripeElementsProvider
                    stripeAccountId={data.stripe_account_id}
                    amount={elementsAmountCents}
                    mode={elementsMode}
                  >
                    <CheckoutForm
                      fullCode={code}
                      stripeAccountId={data.stripe_account_id}
                      setupSubscription={setupSubscription}
                      returnUrl={returnUrl ?? undefined}
                      disabled={checkoutDisabled}
                      chargesEnabled={data.charges_enabled ?? false}
                      isFree={isFreeSelected}
                    />
                  </StripeElementsProvider>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
