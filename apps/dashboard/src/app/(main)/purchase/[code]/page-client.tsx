"use client";

import { CheckoutForm } from "@/components/payments/checkout";
import { StripeElementsProvider } from "@/components/payments/stripe-elements-provider";
import { getPublicEnvVar } from "@/lib/env";
import { StackAdminApp, useUser } from "@stackframe/stack";
import { inlineOfferSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Card, CardContent, Skeleton, Typography } from "@stackframe/stack-ui";
import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as yup from "yup";

type OfferData = {
  offer?: Omit<yup.InferType<typeof inlineOfferSchema>, "included_items" | "server_only">,
  stripe_account_id: string,
  project_id: string,
};

const apiUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_STACK_API_URL is not set");
const baseUrl = new URL("/api/v1", apiUrl).toString();

export default function PageClient({ code }: { code: string }) {
  const [data, setData] = useState<OfferData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPriceId, setSelectedPriceId] = useState<string | null>(null);
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

  const currentAmount = useMemo(() => {
    if (!selectedPriceId || !data?.offer?.prices) {
      return 0;
    }
    return Number(data.offer.prices[selectedPriceId].USD) * 100;
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
      body: JSON.stringify({ full_code: code, price_id: selectedPriceId }),
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
    await adminApp.testModePurchase({ priceId: selectedPriceId, fullCode: code });
    const url = new URL(`/purchase/return`, window.location.origin);
    url.searchParams.set("bypass", "1");
    url.searchParams.set("purchase_full_code", code);
    window.location.assign(url.toString());
  }, [code, adminApp, selectedPriceId]);

  return (
    <div className="flex flex-row">
      <div className="w-1/2 p-6 border-r border-primary/20 h-dvh max-w-md">
        {loading ? (
          <Skeleton className="w-full h-10" />
        ) : error ? (
          <>
            <Typography type="h2" className="mb-2">The following error occurred:</Typography>
            <Typography type="label" variant="secondary">{error}</Typography>
          </>
        ) : (
          <>
            <div className="mb-6">
              <Typography type="h2" className="mb-2">{data?.offer?.display_name || "Plan"}</Typography>
            </div>
            <div className="space-y-3">
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
            amount={currentAmount}
          >
            <CheckoutForm
              fullCode={code}
              stripeAccountId={data.stripe_account_id}
              setupSubscription={setupSubscription}
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
