"use client";

import { CheckoutForm } from "@/components/payments/checkout";
import { StripeElementsProvider } from "@/components/payments/stripe-elements-provider";
import { getPublicEnvVar } from "@/lib/env";
import { StackAdminApp, useUser } from "@stackframe/stack";
import { inlineOfferSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, Input, Skeleton, Typography } from "@stackframe/stack-ui";
import { ArrowRight, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as yup from "yup";

type OfferData = {
  offer?: Omit<yup.InferType<typeof inlineOfferSchema>, "included_items" | "server_only"> & { stackable: boolean },
  stripe_account_id: string,
  project_id: string,
  already_bought_non_stackable?: boolean,
  conflicting_group_offers?: { offer_id: string, display_name: string }[],
};

const apiUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_STACK_API_URL is not set");
const baseUrl = new URL("/api/v1", apiUrl).toString();

export default function PageClient({ code }: { code: string }) {
  const [data, setData] = useState<OfferData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPriceId, setSelectedPriceId] = useState<string | null>(null);
  const [quantityInput, setQuantityInput] = useState<string>("1");
  const user = useUser({ projectIdMustMatch: "internal" });
  const [adminApp, setAdminApp] = useState<StackAdminApp>();

  useEffect(() => {
    if (!user || !data) return;
    runAsynchronouslyWithAlert(user.listOwnedProjects().then(projects => {
      const project = projects.find(p => p.id === data.project_id);
      if (project) {
        setAdminApp(project.app);
      }
    }));
  }, [user, data]);

  const quantityNumber = useMemo((): number => {
    const n = parseInt(quantityInput, 10);
    if (Number.isNaN(n)) {
      return 0;
    }
    return n;
  }, [quantityInput]);

  const unitCents = useMemo((): number => {
    if (!selectedPriceId || !data?.offer?.prices) {
      return 0;
    }
    return Number(data.offer.prices[selectedPriceId].USD) * 100;
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
    if (!selectedPriceId || !data?.offer?.prices) return "subscription";
    const price = data.offer.prices[selectedPriceId];
    return price.interval ? "subscription" : "payment";
  }, [data, selectedPriceId]);

  const shortenedInterval = (interval: [number, string]) => {
    if (interval[0] === 1) {
      return interval[1];
    }
    return `${interval[0]} ${interval[1]}s`;
  };

  const validateCode = useCallback(async () => {
    const response = await fetch(`${baseUrl}/payments/purchases/validate-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ full_code: code }),
    });
    if (!response.ok) {
      throw new Error('Failed to validate code');
    }
    const result = await response.json();
    setData(result);
    if (result?.offer?.prices) {
      const firstPriceId = Object.keys(result.offer.prices)[0];
      setSelectedPriceId(firstPriceId);
    }
  }, [code]);

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
    if (!adminApp || !selectedPriceId) {
      return;
    }
    if (quantityNumber < 1 || isTooLarge) {
      return;
    }
    await adminApp.testModePurchase({ priceId: selectedPriceId, fullCode: code, quantity: quantityNumber });
    const url = new URL(`/purchase/return`, window.location.origin);
    url.searchParams.set("bypass", "1");
    url.searchParams.set("purchase_full_code", code);
    window.location.assign(url.toString());
  }, [code, adminApp, selectedPriceId, quantityNumber, isTooLarge]);

  return (
    <div className="flex flex-row">
      <div className="w-1/2 p-6 border-r border-primary/20 h-dvh max-w-md">
        {loading ? (
          <Skeleton className="w-full h-10" />
        ) : error ? (
          <>
            <Typography type="h2" className="mb-2">Invalid URL</Typography>
            <Typography type="label" variant="secondary">
              The purchase code is invalid or has expired.
            </Typography>
          </>
        ) : (
          <>
            <div className="mb-6">
              <Typography type="h2" className="mb-2">{data?.offer?.display_name || "Plan"}</Typography>
            </div>
            <div className="space-y-3">
              {data?.already_bought_non_stackable ? (
                <Alert variant="destructive">
                  <AlertTitle>Already purchased</AlertTitle>
                  <AlertDescription>
                    You already have this offer.
                  </AlertDescription>
                </Alert>
              ) : data?.conflicting_group_offers && data.conflicting_group_offers.length > 0 ? (
                <Alert>
                  <AlertTitle>Plan change</AlertTitle>
                  <AlertDescription>
                    {data.conflicting_group_offers.length === 1 ? (
                      <>This purchase will change your plan from {data.conflicting_group_offers[0].display_name}.</>
                    ) : (
                      <>This purchase will change your plan from one of your existing plans.</>
                    )}
                  </AlertDescription>
                </Alert>
              ) : null}
              {data?.offer?.prices && typedEntries(data.offer.prices).map(([priceId, priceData]) => (
                <Card
                  key={priceId}
                  className={`border cursor-pointer transition-colors ${selectedPriceId === priceId ? 'border-blue-500' : 'hover:border-primary/30'}`}
                  onClick={() => setSelectedPriceId(priceId)}
                >
                  <CardContent className="p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <Typography type="h4">{priceId}</Typography>
                      </div>
                      <div className="text-right">
                        <Typography type="h3">
                          ${priceData.USD}
                          {priceData.interval && (
                            <span className="text-sm text-primary/50">
                              {" "}/ {shortenedInterval(priceData.interval)}
                            </span>
                          )}
                        </Typography>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {data?.offer?.stackable && selectedPriceId && (
                <div className="pt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Typography type="label">Quantity</Typography>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        disabled={quantityNumber <= 1}
                        onClick={() => setQuantityInput(String(Math.max(1, quantityNumber - 1)))}
                      >
                        <Minus className="w-4 h-4" />
                      </Button>
                      <Input
                        className="text-center w-20"
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
                        onClick={() => setQuantityInput(String(quantityNumber + 1))}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-right">
                    <Typography type="footnote" variant="destructive">
                      {quantityNumber < 1 ?
                        "Enter a quantity of at least 1." :
                        isTooLarge ?
                          "Amount exceeds maximum of $999,999" :
                          " "
                      }
                    </Typography>
                  </div>
                  <div className="pt-4 flex items-baseline justify-between">
                    <Typography type="label">Total</Typography>
                    <Typography type="h4">
                      ${selectedPriceId ? (Number(data.offer.prices[selectedPriceId].USD) * Math.max(0, quantityNumber)) : 0}
                      {selectedPriceId && data.offer.prices[selectedPriceId].interval && (
                        <span className="text-sm text-primary/50">
                          {" "}/ {shortenedInterval(data.offer.prices[selectedPriceId].interval!)}
                        </span>
                      )}
                    </Typography>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div className="grow relative flex justify-center items-center bg-primary/5">
        {adminApp && (
          <div className="absolute top-4 right-4 max-w-xs">
            <BypassInfo handleBypass={handleBypass} />
          </div>
        )}
        {data && (
          <StripeElementsProvider
            stripeAccountId={data.stripe_account_id}
            amount={elementsAmountCents}
            mode={elementsMode}
          >
            <CheckoutForm
              fullCode={code}
              stripeAccountId={data.stripe_account_id}
              setupSubscription={setupSubscription}
              disabled={quantityNumber < 1 || isTooLarge || data.already_bought_non_stackable === true}
            />
          </StripeElementsProvider>
        )}
      </div>
    </div>
  );
}

function BypassInfo({ handleBypass }: { handleBypass: () => Promise<void> }) {
  return (
    <Card className="border-primary/30 bg-secondary animate-fade-in">
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <Typography type="label">Test mode bypass</Typography>
            <Typography type="footnote" variant="secondary">Not shown to customers</Typography>
          </div>
          <Button onClick={handleBypass} size="icon" variant="ghost">
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
