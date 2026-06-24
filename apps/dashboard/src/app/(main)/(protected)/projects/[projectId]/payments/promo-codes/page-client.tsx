"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, CopyField, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography } from "@/components/ui";
import { PageLayout } from "../../page-layout";
import type { PromoCodeCreate, PromoCodeRead, PromoCodeRedemptionRead } from "@hexclave/shared/dist/interface/crud/promo-codes";
import { Result } from "@hexclave/shared/dist/utils/results";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { typedEntries } from "@hexclave/shared/dist/utils/objects";
import { useCallback, useEffect, useMemo, useState } from "react";

type DiscountType = "percent" | "amount_off_usd";
type SubscriptionDuration = "first_invoice" | "forever";

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "The request failed. Please try again.";
}

function money(cents: number | null | undefined): string {
  if (cents == null) {
    return "-";
  }
  return `$${(cents / 100).toFixed(2)}`;
}

function millisToDate(millis: number | null): string {
  if (millis == null) {
    return "-";
  }
  return new Date(millis).toLocaleString();
}

function discountLabel(code: PromoCodeRead): string {
  if (code.discount_type === "percent") {
    return `${((code.percent_off_bps ?? 0) / 100).toFixed(2)}%`;
  }
  return money(code.amount_off_usd_cents);
}

function readDiscountType(value: string): DiscountType {
  if (value === "percent" || value === "amount_off_usd") {
    return value;
  }
  throw new Error(`Unexpected promo discount type: ${value}`);
}

function readSubscriptionDuration(value: string): SubscriptionDuration {
  if (value === "first_invoice" || value === "forever") {
    return value;
  }
  throw new Error(`Unexpected promo subscription duration: ${value}`);
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const productOptions = useMemo(() => {
    return typedEntries(config.payments.products).map(([id, product]) => ({
      id,
      label: product.displayName || id,
      prices: typedEntries(product.prices).map(([priceId, price]) => ({
        id: priceId,
        label: `${priceId} (${price.USD} USD${price.interval ? ` / ${price.interval[0]} ${price.interval[1]}` : ""})`,
      })),
    }));
  }, [config.payments.products]);

  const [items, setItems] = useState<PromoCodeRead[]>([]);
  const [redemptions, setRedemptions] = useState<PromoCodeRedemptionRead[]>([]);
  const [selectedPromoCodeId, setSelectedPromoCodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [redemptionsLoading, setRedemptionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [rawCode, setRawCode] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("percent");
  const [percentOff, setPercentOff] = useState("20");
  const [amountOffUsd, setAmountOffUsd] = useState("10");
  const [subscriptionDuration, setSubscriptionDuration] = useState<SubscriptionDuration>("first_invoice");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [productId, setProductId] = useState("");
  const [priceId, setPriceId] = useState("");

  const loadPromoCodes = useCallback(async () => {
    setLoading(true);
    const result = await Result.fromPromise(adminApp.listPromoCodes({ includeDeleted: true, limit: 100 }));
    setLoading(false);
    if (result.status === "error") {
      setError(errorMessage(result.error));
      return;
    }
    setError(null);
    setItems(result.data.items);
  }, [adminApp]);

  useEffect(() => {
    runAsynchronously(loadPromoCodes());
  }, [loadPromoCodes]);

  const loadRedemptions = useCallback(async (promoCodeId: string) => {
    setSelectedPromoCodeId(promoCodeId);
    setRedemptionsLoading(true);
    const result = await Result.fromPromise(adminApp.listPromoCodeRedemptions(promoCodeId, { limit: 100 }));
    setRedemptionsLoading(false);
    if (result.status === "error") {
      setError(errorMessage(result.error));
      return;
    }
    setError(null);
    setRedemptions(result.data.items);
  }, [adminApp]);

  const selectedProductPrices = productOptions.find((product) => product.id === productId)?.prices ?? [];

  const createPromoCode = async () => {
    const maxRedemptionsNumber = maxRedemptions.trim() ? Number(maxRedemptions) : null;
    const data: PromoCodeCreate = {
      ...(rawCode.trim() ? { code: rawCode.trim() } : {}),
      ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
      discount_type: discountType,
      subscription_duration: subscriptionDuration,
      ...(discountType === "percent" ? { percent_off_bps: Math.round(Number(percentOff) * 100) } : { amount_off_usd_cents: Math.round(Number(amountOffUsd) * 100) }),
      ...(maxRedemptionsNumber != null ? { max_redemptions: maxRedemptionsNumber } : {}),
      ...(productId ? { product_id: productId } : {}),
      ...(priceId ? { price_id: priceId } : {}),
    };
    const result = await Result.fromPromise(adminApp.createPromoCode(data));
    if (result.status === "error") {
      setError(errorMessage(result.error));
      return;
    }
    setError(null);
    setCreatedCode(result.data.code);
    setDisplayName("");
    setRawCode("");
    setMaxRedemptions("");
    await loadPromoCodes();
  };

  const toggleDisabled = async (code: PromoCodeRead) => {
    const result = await Result.fromPromise(adminApp.updatePromoCode(code.id, { disabled: code.disabled_at_millis == null }));
    if (result.status === "error") {
      setError(errorMessage(result.error));
      return;
    }
    setError(null);
    await loadPromoCodes();
  };

  const deletePromoCode = async (code: PromoCodeRead) => {
    const result = await Result.fromPromise(adminApp.deletePromoCode(code.id));
    if (result.status === "error") {
      setError(errorMessage(result.error));
      return;
    }
    setError(null);
    await loadPromoCodes();
  };

  return (
    <PageLayout
      title="Promo Codes"
      description="Create DB-backed checkout discounts without changing config-backed products or prices."
      actions={(
        <Button onClick={loadPromoCodes} variant="outline">
          Refresh
        </Button>
      )}
    >
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create Promo Code</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>Display name</Label>
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Launch offer" />
          </div>
          <div className="space-y-2">
            <Label>Code</Label>
            <Input value={rawCode} onChange={(event) => setRawCode(event.target.value)} placeholder="Auto-generate" />
          </div>
          <div className="space-y-2">
            <Label>Discount</Label>
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <Select value={discountType} onValueChange={(value) => setDiscountType(readDiscountType(value))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent</SelectItem>
                  <SelectItem value="amount_off_usd">USD off</SelectItem>
                </SelectContent>
              </Select>
              {discountType === "percent" ? (
                <Input value={percentOff} onChange={(event) => setPercentOff(event.target.value)} inputMode="decimal" />
              ) : (
                <Input value={amountOffUsd} onChange={(event) => setAmountOffUsd(event.target.value)} inputMode="decimal" />
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Subscription duration</Label>
            <Select value={subscriptionDuration} onValueChange={(value) => setSubscriptionDuration(readSubscriptionDuration(value))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="first_invoice">First invoice</SelectItem>
                <SelectItem value="forever">Forever</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Max redemptions</Label>
            <Input value={maxRedemptions} onChange={(event) => setMaxRedemptions(event.target.value)} inputMode="numeric" placeholder="Unlimited" />
          </div>
          <div className="space-y-2">
            <Label>Product scope</Label>
            <Select value={productId || "all"} onValueChange={(value) => {
              setProductId(value === "all" ? "" : value);
              setPriceId("");
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All products</SelectItem>
                {productOptions.map((product) => (
                  <SelectItem key={product.id} value={product.id}>{product.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Price scope</Label>
            <Select value={priceId || "all"} disabled={!productId} onValueChange={(value) => setPriceId(value === "all" ? "" : value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All prices</SelectItem>
                {selectedProductPrices.map((price) => (
                  <SelectItem key={price.id} value={price.id}>{price.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={createPromoCode}>
              Create
            </Button>
          </div>
        </CardContent>
      </Card>

      {createdCode && (
        <Card>
          <CardHeader>
            <CardTitle>New Code</CardTitle>
          </CardHeader>
          <CardContent>
            <CopyField type="input" value={createdCode} monospace initialCopied label="Copy this code now. It is only returned once." />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Codes</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Typography variant="secondary" className="text-sm">Loading promo codes...</Typography>
          ) : items.length === 0 ? (
            <Typography variant="secondary" className="text-sm">No promo codes yet.</Typography>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((code) => (
                    <TableRow key={code.id}>
                      <TableCell>{code.display_name || code.id}</TableCell>
                      <TableCell className="font-mono text-xs">{code.code_prefix ?? ""}...{code.code_last4 ?? ""}</TableCell>
                      <TableCell>{discountLabel(code)}</TableCell>
                      <TableCell className="text-xs">
                        {code.product_id ?? "All products"}{code.price_id ? ` / ${code.price_id}` : ""}
                      </TableCell>
                      <TableCell>
                        {code.deleted_at_millis != null ? <Badge variant="secondary">Deleted</Badge> : code.disabled_at_millis != null ? <Badge variant="secondary">Disabled</Badge> : <Badge>Active</Badge>}
                      </TableCell>
                      <TableCell>{millisToDate(code.created_at_millis)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => loadRedemptions(code.id)}>Redemptions</Button>
                          {code.deleted_at_millis == null && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => toggleDisabled(code)}>
                                {code.disabled_at_millis == null ? "Disable" : "Enable"}
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => deletePromoCode(code)}>Delete</Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={selectedPromoCodeId != null} onOpenChange={(open) => {
        if (!open) {
          setSelectedPromoCodeId(null);
          setRedemptions([]);
        }
      }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Redemptions</DialogTitle>
            <DialogDescription>{selectedPromoCodeId}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {redemptionsLoading ? (
              <Typography variant="secondary" className="text-sm">Loading redemptions...</Typography>
            ) : redemptions.length === 0 ? (
              <Typography variant="secondary" className="text-sm">No redemptions recorded for this code.</Typography>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Original</TableHead>
                      <TableHead>Discount</TableHead>
                      <TableHead>Final</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {redemptions.map((redemption) => (
                      <TableRow key={redemption.id}>
                        <TableCell className="font-mono text-xs">{redemption.customer_type}:{redemption.customer_id}</TableCell>
                        <TableCell><Badge variant="secondary">{redemption.status}</Badge></TableCell>
                        <TableCell>{money(redemption.original_amount_usd_cents)}</TableCell>
                        <TableCell>{money(redemption.discount_amount_usd_cents)}</TableCell>
                        <TableCell>{money(redemption.final_amount_usd_cents)}</TableCell>
                        <TableCell>{millisToDate(redemption.created_at_millis)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedPromoCodeId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
