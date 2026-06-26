"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { CopyField, Label } from "@/components/ui";
import { PageLayout } from "../../page-layout";
import type { PromoCodeCreate, PromoCodeRead, PromoCodeRedemptionRead } from "@hexclave/shared/dist/interface/crud/promo-codes";
import { Result } from "@hexclave/shared/dist/utils/results";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { typedEntries } from "@hexclave/shared/dist/utils/objects";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignInput,
  DesignSelectorDropdown,
  DesignDialog,
  DesignDialogClose,
} from "@/components/design-components";
import {
  DataGrid,
  useDataGridUrlState,
  useDataSource,
  createDefaultDataGridState,
  type DataGridColumnDef,
} from "@hexclave/dashboard-ui-components";
import { GiftIcon, TagIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";

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

  const toggleDisabled = useCallback(async (code: PromoCodeRead) => {
    const result = await Result.fromPromise(adminApp.updatePromoCode(code.id, { disabled: code.disabled_at_millis == null }));
    if (result.status === "error") {
      setError(errorMessage(result.error));
      return;
    }
    setError(null);
    await loadPromoCodes();
  }, [adminApp, loadPromoCodes]);

  const deletePromoCode = useCallback(async (code: PromoCodeRead) => {
    const result = await Result.fromPromise(adminApp.deletePromoCode(code.id));
    if (result.status === "error") {
      setError(errorMessage(result.error));
      return;
    }
    setError(null);
    await loadPromoCodes();
  }, [adminApp, loadPromoCodes]);

  // Promo Codes DataGrid columns
  const columns = useMemo<DataGridColumnDef<PromoCodeRead>[]>(() => [
    {
      id: "name",
      header: "Name",
      accessor: "display_name",
      width: 200,
      type: "string",
      renderCell: ({ row }) => (
        <span className="font-medium">{row.display_name || row.id}</span>
      ),
    },
    {
      id: "code",
      header: "Code",
      width: 150,
      type: "string",
      renderCell: ({ row }) => (
        <span className="font-mono text-xs">{row.code_prefix ?? ""}...{row.code_last4 ?? ""}</span>
      ),
    },
    {
      id: "discount",
      header: "Discount",
      width: 120,
      type: "string",
      renderCell: ({ row }) => (
        <span>{discountLabel(row)}</span>
      ),
    },
    {
      id: "scope",
      header: "Scope",
      width: 180,
      type: "string",
      renderCell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.product_id ?? "All products"}{row.price_id ? ` / ${row.price_id}` : ""}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      width: 120,
      type: "singleSelect",
      valueOptions: [
        { value: "active", label: "Active" },
        { value: "disabled", label: "Disabled" },
        { value: "deleted", label: "Deleted" },
      ],
      renderCell: ({ row }) => {
        if (row.deleted_at_millis != null) {
          return <DesignBadge label="Deleted" color="red" size="sm" />;
        }
        if (row.disabled_at_millis != null) {
          return <DesignBadge label="Disabled" color="orange" size="sm" />;
        }
        return <DesignBadge label="Active" color="green" size="sm" />;
      },
    },
    {
      id: "created",
      header: "Created",
      width: 180,
      type: "string",
      renderCell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{millisToDate(row.created_at_millis)}</span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      width: 280,
      align: "right",
      sortable: false,
      renderCell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <DesignButton size="sm" variant="outline" onClick={() => loadRedemptions(row.id)}>
            Redemptions
          </DesignButton>
          {row.deleted_at_millis == null && (
            <>
              <DesignButton size="sm" variant="outline" onClick={() => toggleDisabled(row)}>
                {row.disabled_at_millis == null ? "Disable" : "Enable"}
              </DesignButton>
              <DesignButton size="sm" variant="destructive" onClick={() => deletePromoCode(row)}>
                Delete
              </DesignButton>
            </>
          )}
        </div>
      ),
    },
  ], [loadRedemptions, toggleDisabled, deletePromoCode]);

  const [gridState, setGridState] = useDataGridUrlState(columns, { paramPrefix: "promocodes" });
  const gridData = useDataSource({
    data: items,
    columns,
    getRowId: (row) => row.id,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "client",
  });

  // Redemption DataGrid columns
  const redemptionColumns = useMemo<DataGridColumnDef<PromoCodeRedemptionRead>[]>(() => [
    {
      id: "customer",
      header: "Customer",
      width: 250,
      type: "string",
      renderCell: ({ row }) => (
        <span className="font-mono text-xs">{row.customer_type}:{row.customer_id}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      width: 120,
      type: "singleSelect",
      valueOptions: [
        { value: "applied", label: "Applied" },
        { value: "reserved", label: "Reserved" },
        { value: "voided", label: "Voided" },
      ],
      renderCell: ({ row }) => {
        const color = row.status === "applied" ? "green" : row.status === "voided" ? "red" : "orange";
        return <DesignBadge label={row.status} color={color} size="sm" />;
      },
    },
    {
      id: "original",
      header: "Original",
      width: 120,
      type: "string",
      renderCell: ({ row }) => (
        <span>{money(row.original_amount_usd_cents)}</span>
      ),
    },
    {
      id: "discount",
      header: "Discount",
      width: 120,
      type: "string",
      renderCell: ({ row }) => (
        <span>{money(row.discount_amount_usd_cents)}</span>
      ),
    },
    {
      id: "final",
      header: "Final",
      width: 120,
      type: "string",
      renderCell: ({ row }) => (
        <span>{money(row.final_amount_usd_cents)}</span>
      ),
    },
    {
      id: "created",
      header: "Created",
      width: 180,
      type: "string",
      renderCell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{millisToDate(row.created_at_millis)}</span>
      ),
    },
  ], []);

  const [redemptionGridState, setRedemptionGridState] = useState(() => createDefaultDataGridState(redemptionColumns));
  const redemptionGridData = useDataSource({
    data: redemptions,
    columns: redemptionColumns,
    getRowId: (row) => row.id,
    sorting: redemptionGridState.sorting,
    quickSearch: redemptionGridState.quickSearch,
    pagination: redemptionGridState.pagination,
    paginationMode: "client",
  });

  return (
    <PageLayout
      title="Promo Codes"
      description="Create DB-backed checkout discounts without changing config-backed products or prices."
      actions={(
        <DesignButton onClick={loadPromoCodes} variant="outline" size="sm">
          Refresh
        </DesignButton>
      )}
    >
      {error && (
        <DesignAlert
          variant="error"
          title="Error"
          description={error}
        />
      )}

      <DesignCard
        title="Create Promo Code"
        icon={PlusIcon}
        gradient="default"
      >
        <div className="grid gap-4 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>Display name</Label>
            <DesignInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Launch offer" size="sm" />
          </div>
          <div className="space-y-2">
            <Label>Code</Label>
            <DesignInput value={rawCode} onChange={(event) => setRawCode(event.target.value)} placeholder="Auto-generate" size="sm" />
          </div>
          <div className="space-y-2">
            <Label>Discount</Label>
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <DesignSelectorDropdown
                value={discountType}
                onValueChange={(value) => setDiscountType(readDiscountType(value))}
                options={[
                  { value: "percent", label: "Percent" },
                  { value: "amount_off_usd", label: "USD off" },
                ]}
                size="sm"
              />
              {discountType === "percent" ? (
                <DesignInput value={percentOff} onChange={(event) => setPercentOff(event.target.value)} inputMode="decimal" size="sm" />
              ) : (
                <DesignInput value={amountOffUsd} onChange={(event) => setAmountOffUsd(event.target.value)} inputMode="decimal" size="sm" />
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Subscription duration</Label>
            <DesignSelectorDropdown
              value={subscriptionDuration}
              onValueChange={(value) => setSubscriptionDuration(readSubscriptionDuration(value))}
              options={[
                { value: "first_invoice", label: "First invoice" },
                { value: "forever", label: "Forever" },
              ]}
              size="sm"
            />
          </div>
          <div className="space-y-2">
            <Label>Max redemptions</Label>
            <DesignInput value={maxRedemptions} onChange={(event) => setMaxRedemptions(event.target.value)} inputMode="numeric" placeholder="Unlimited" size="sm" />
          </div>
          <div className="space-y-2">
            <Label>Product scope</Label>
            <DesignSelectorDropdown
              value={productId || "all"}
              onValueChange={(value) => {
                setProductId(value === "all" ? "" : value);
                setPriceId("");
              }}
              options={[
                { value: "all", label: "All products" },
                ...productOptions.map((product) => ({ value: product.id, label: product.label })),
              ]}
              size="sm"
            />
          </div>
          <div className="space-y-2">
            <Label>Price scope</Label>
            <DesignSelectorDropdown
              value={priceId || "all"}
              disabled={!productId}
              onValueChange={(value) => setPriceId(value === "all" ? "" : value)}
              options={[
                { value: "all", label: "All prices" },
                ...selectedProductPrices.map((price) => ({ value: price.id, label: price.label })),
              ]}
              size="sm"
            />
          </div>
          <div className="flex items-end">
            <DesignButton className="w-full" onClick={createPromoCode} size="sm">
              Create
            </DesignButton>
          </div>
        </div>
      </DesignCard>

      {createdCode && (
        <DesignCard
          title="New Code"
          icon={TagIcon}
          gradient="green"
        >
          <CopyField type="input" value={createdCode} monospace initialCopied label="Copy this code now. It is only returned once." />
        </DesignCard>
      )}

      <DesignCard
        title="Codes"
        icon={TagIcon}
        gradient="default"
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading promo codes...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No promo codes yet.</p>
        ) : (
          <DataGrid
            columns={columns}
            rows={gridData.rows}
            getRowId={(row) => row.id}
            totalRowCount={gridData.totalRowCount}
            state={gridState}
            onChange={setGridState}
            fillHeight={false}
          />
        )}
      </DesignCard>

      <DesignDialog
        open={selectedPromoCodeId != null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedPromoCodeId(null);
            setRedemptions([]);
          }
        }}
        size="4xl"
        icon={GiftIcon}
        title="Redemptions"
        description={`Promo Code ID: ${selectedPromoCodeId}`}
        footer={
          <DesignDialogClose asChild>
            <DesignButton variant="outline" size="sm" onClick={() => setSelectedPromoCodeId(null)}>Close</DesignButton>
          </DesignDialogClose>
        }
      >
        {redemptionsLoading ? (
          <p className="text-sm text-muted-foreground">Loading redemptions...</p>
        ) : redemptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No redemptions recorded for this code.</p>
        ) : (
          <DataGrid
            columns={redemptionColumns}
            rows={redemptionGridData.rows}
            getRowId={(row) => row.id}
            totalRowCount={redemptionGridData.totalRowCount}
            state={redemptionGridState}
            onChange={setRedemptionGridState}
            fillHeight={false}
          />
        )}
      </DesignDialog>
    </PageLayout>
  );
}
