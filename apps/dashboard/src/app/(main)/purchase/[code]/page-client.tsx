"use client";

import { CheckoutForm } from "@/components/payments/checkout";
import { StripeElementsProvider } from "@/components/payments/stripe-elements-provider";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, Input, Skeleton, Typography } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { inlineProductSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import Image from 'next/image';
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as yup from "yup";

type ProductData = {
  product?: Omit<yup.InferType<typeof inlineProductSchema>, "included_items" | "server_only"> & { stackable: boolean },
  stripe_account_id: string,
  project_id: string,
  project_logo_url: string | null,
  already_bought_non_stackable?: boolean,
  conflicting_products?: { product_id: string, display_name: string }[],
  test_mode: boolean,
  charges_enabled: boolean,
};

const apiUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_STACK_API_URL is not set");
const baseUrl = new URL("/api/v1", apiUrl).toString();

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
    return Number(data.product.prices[selectedPriceId].USD) * 100;
  }, [data, selectedPriceId]);

  const MAX_STRIPE_AMOUNT_CENTS = 999_999 * 100;

  const rawAmountCents = useMemo(() => {
    return unitCents * Math.max(0, quantityNumber);
  }, [unitCents, quantityNumber]);

  const isTooLarge = rawAmountCents > MAX_STRIPE_AMOUNT_CENTS;

  const elementsAmountCents = useMemo(() => {
    if (!unitCents) return 0;
    if (rawAmountCents < 1) return unitCents;
    if (isTooLarge) return MAX_STRIPE_AMOUNT_CENTS;
    return rawAmountCents;
  }, [unitCents, rawAmountCents, isTooLarge, MAX_STRIPE_AMOUNT_CENTS]);

  const elementsMode = useMemo<"subscription" | "payment">(() => {
    if (!selectedPriceId || !data?.product?.prices) return "subscription";
    const price = data.product.prices[selectedPriceId];
    return price.interval ? "subscription" : "payment";
  }, [data, selectedPriceId]);

  const shortenedInterval = (interval: [number, string]) => {
    if (interval[0] === 1) {
      return interval[1];
    }
    return `${interval[0]} ${interval[1]}s`;
  };

  const getPriceLabel = (interval: [number, string] | undefined): string => {
    if (!interval) {
      return "One-time";
    }
    const [count, unit] = interval;

    if (count === 1) {
      if (unit === "day") {
        return "Daily";
      } else if (unit === "week") {
        return "Weekly";
      } else if (unit === "month") {
        return "Monthly";
      } else if (unit === "year") {
        return "Yearly";
      } else {
        return `Every ${unit}`;
      }
    }

    if (unit === "day") {
      return `Every ${count} days`;
    } else if (unit === "week") {
      return `Once every ${count} weeks`;
    } else if (unit === "month") {
      return `Every ${count} months`;
    } else if (unit === "year") {
      return `Every ${count} years`;
    } else {
      return `Every ${count} ${unit}s`;
    }
  };

  const validateCode = useCallback(async () => {
    const response = await fetch(`${baseUrl}/payments/purchases/validate-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        full_code: code,
        return_url: returnUrl ?? undefined,
      }),
    });
    if (!response.ok) {
      throw new Error('Failed to validate code');
    }
    const result = await response.json();
    setData(result);
    if (result?.product?.prices) {
      const firstPriceId = Object.keys(result.product.prices)[0];
      setSelectedPriceId(firstPriceId);
    }
  }, [code, returnUrl]);

  useEffect(() => {
    setLoading(true);
    validateCode().catch((err) => {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }).finally(() => {
      setLoading(false);
    });
  }, [validateCode]);

  const setupSubscription = async () => {
    const response = await fetch(`${baseUrl}/payments/purchases/purchase-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_code: code, price_id: selectedPriceId, quantity: quantityNumber }),
    });
    const result = await response.json();
    if (!result.client_secret) {
      throw new Error("Failed to setup subscription");
    }
    return result.client_secret;
  };

  const handleBypass = useCallback(async () => {
    if (quantityNumber < 1 || isTooLarge) {
      return;
    }
    const response = await fetch(`${baseUrl}/internal/payments/test-mode-purchase-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_code: code,
        price_id: selectedPriceId,
        quantity: quantityNumber
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

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <div className="w-full md:w-1/2 flex flex-col bg-background border-b md:border-b-0 md:border-r border-primary/10">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-xl mx-auto px-4 py-6 md:py-8">
            {loading ? (
              <div>
                <Skeleton className="h-10 w-10 rounded-lg" />
                <Skeleton className="w-3/4 h-7 mt-5" />
                <Skeleton className="w-full h-16 mt-5" />
                <Skeleton className="w-full h-16 mt-5" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                  <svg className="w-6 h-6 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <Typography type="h2" className="mb-2 text-xl">Invalid Purchase Code</Typography>
                <Typography type="p" variant="secondary" className="max-w-md text-sm">
                  The purchase code is invalid or has expired. Please check your link and try again.
                </Typography>
              </div>
            ) : (
              <div className="space-y-5">
                {data?.project_logo_url && (
                  <div className="flex items-center">
                    <Image
                      src={data.project_logo_url}
                      alt="Project logo"
                      className="h-10 w-10 object-contain"
                      width={40}
                      height={40}
                      unoptimized
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <Typography type="h2" className="text-xl font-semibold">
                    {data?.product?.display_name || "Choose Your Plan"}
                  </Typography>
                </div>

                {(data?.already_bought_non_stackable || (data?.conflicting_products && data.conflicting_products.length > 0)) && (
                  <div className="space-y-2">
                    {data.already_bought_non_stackable && (
                      <Alert variant="destructive">
                        <AlertTitle className="text-sm">Already Purchased</AlertTitle>
                        <AlertDescription className="text-sm">
                          You already have this product and cannot purchase it again.
                        </AlertDescription>
                      </Alert>
                    )}
                    {data.conflicting_products && data.conflicting_products.length > 0 && (
                      <Alert>
                        <AlertTitle className="text-sm">Plan Change Detected</AlertTitle>
                        <AlertDescription className="text-sm">
                          {data.conflicting_products.length === 1 ? (
                            <>This purchase will replace your current plan: <strong>{data.conflicting_products[0].display_name}</strong></>
                          ) : (
                            <>This purchase will replace one of your existing plans.</>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                {data?.product?.prices && typedEntries(data.product.prices).length > 0 && (
                  <div className="space-y-3">
                    <Typography type="label" className="text-xs font-medium uppercase tracking-wide text-primary/60">
                      Select a Pricing Option
                    </Typography>
                    <div className="grid gap-3">
                      {typedEntries(data.product.prices).map(([priceId, priceData], index) => (
                        <Card
                          key={priceId}
                          className={`cursor-pointer transition-all duration-200 border-0 ${
                            selectedPriceId === priceId
                              ? 'outline-2 outline-primary outline'
                              : 'outline outline-2 outline-primary/20 hover:outline-primary/40'
                          }`}
                          onClick={() => setSelectedPriceId(priceId)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                  <Typography type="h4" className="text-sm font-semibold">
                                    {getPriceLabel(priceData.interval)}
                                  </Typography>
                                  {selectedPriceId === priceId && (
                                    <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                                      <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                      </svg>
                                    </div>
                                  )}
                                </div>

                              </div>
                              <div className="text-right">
                                <Typography type="h3" className="text-lg font-bold">
                                  ${priceData.USD}
                                </Typography>
                                {priceData.interval && (
                                  <Typography type="p" variant="secondary" className="text-xs mt-0.5">
                                    per {shortenedInterval(priceData.interval)}
                                  </Typography>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {data?.product?.stackable && selectedPriceId && (
                  <div className="bg-primary/5 rounded-lg p-4 space-y-4 border border-primary/10">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Typography type="label" className="text-sm font-semibold">
                          Quantity
                        </Typography>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            disabled={quantityNumber <= 1}
                            onClick={() => setQuantityInput(String(Math.max(1, quantityNumber - 1)))}
                          >
                            <MinusIcon className="w-3.5 h-3.5" />
                          </Button>
                          <Input
                            className="text-center w-20 h-8 text-sm font-semibold"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            type="text"
                            value={quantityInput}
                            onChange={e => {
                              const digitsOnly = e.target.value.replace(/[^0-9]/g, "");
                              setQuantityInput(digitsOnly);
                            }}
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            onClick={() => setQuantityInput(String(quantityNumber + 1))}
                          >
                            <PlusIcon className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      {(quantityNumber < 1 || isTooLarge) && (
                        <Typography type="footnote" variant="destructive" className="text-xs">
                          {quantityNumber < 1
                            ? "Please enter a quantity of at least 1."
                            : "Amount exceeds the maximum limit of $999,999. Please reduce the quantity."}
                        </Typography>
                      )}
                    </div>

                    <div className="pt-3 border-t border-primary/10">
                      <div className="flex items-baseline justify-between">
                        <Typography type="label" className="text-sm font-semibold">
                          Total Amount
                        </Typography>
                        <div className="text-right">
                          <Typography type="h2" className="text-xl font-bold">
                            ${selectedPriceId ? (Number(data.product.prices[selectedPriceId].USD) * Math.max(0, quantityNumber)).toFixed(2) : "0.00"}
                          </Typography>
                          {selectedPriceId && data.product.prices[selectedPriceId].interval && (
                            <Typography type="p" variant="secondary" className="text-xs mt-0.5">
                              per {shortenedInterval(data.product.prices[selectedPriceId].interval!)}
                            </Typography>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="w-full md:w-1/2 flex flex-grow items-center justify-center bg-gradient-to-br from-primary/5 via-primary/3 to-background p-6 md:p-12">
        {data && (
          <div className="w-full max-w-lg">
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
                disabled={quantityNumber < 1 || isTooLarge || data.already_bought_non_stackable === true}
                chargesEnabled={data.charges_enabled}
                onTestModeBypass={data.test_mode ? handleBypass : undefined}
              />
            </StripeElementsProvider>
          </div>
        )}
      </div>
    </div>
  );
}
