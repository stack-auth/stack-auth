"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { useRouter } from "@/components/router";
import { SettingCard } from "@/components/settings";
import { ActionCell, Button, DataTable, DataTableColumnHeader, TextCell, Typography } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Plus } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import * as yup from "yup";
import { useAdminApp } from "../../use-admin-app";

export default function ProductDetailsClient() {
  const router = useRouter();
  const params = useParams();
  const productId = params.productId as string;
  const [error, setError] = useState<string | null>(null);
  const [isAddPriceDialogOpen, setIsAddPriceDialogOpen] = useState(false);
  const [isEditPriceDialogOpen, setIsEditPriceDialogOpen] = useState(false);
  const [selectedPrice, setSelectedPrice] = useState<any>(null);

  const stackAdminApp = useAdminApp();
  const projectData = stackAdminApp.useProject();
  const adminProducts = stackAdminApp.useProducts();
  const prices = stackAdminApp.useProductPrices(productId);

  // Find the current product from the products list
  const product = adminProducts.find(p => p.id === productId);
  const stripeConfig = projectData.config.stripeConfig;
  const stripeConfigured = !!stripeConfig;

  const handleAddPrice = async (values: any) => {
    try {
      await stackAdminApp.createPrice({
        productId: productId,
        name: values.name,
        amount: Number(values.amount),
        currency: values.currency,
        interval: values.interval || null,
        intervalCount: values.interval ? Number(values.interval_count) : null,
        active: values.active !== undefined ? values.active : true,
      });
    } catch (err) {
      console.error("Error creating price:", err);
      setError(err instanceof Error ? err.message : "Failed to create price");
    }
  };

  const handleUpdatePrice = async (values: any) => {
    if (!selectedPrice) return;

    try {
      await stackAdminApp.updatePrice(selectedPrice.id, {
        name: values.name,
        amount: Number(values.amount),
        currency: values.currency,
        interval: values.interval || null,
        intervalCount: values.interval ? Number(values.interval_count) : null,
        active: values.active,
      });
    } catch (err) {
      console.error("Error updating price:", err);
      setError(err instanceof Error ? err.message : "Failed to update price");
    }
  };

  const handleDeletePrice = async (priceId: string) => {
    try {
      await stackAdminApp.deletePrice(priceId);
    } catch (err) {
      console.error("Error deleting price:", err);
      setError(err instanceof Error ? err.message : "Failed to delete price");
    }
  };

  // Format currency amount from cents to dollars/euros/etc
  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount / 100);
  };

  // Format pricing interval
  const formatInterval = (interval: string | null, intervalCount: number | null) => {
    if (!interval) return "One-time";

    const count = intervalCount || 1;

    if (count === 1) {
      return interval.charAt(0).toUpperCase() + interval.slice(1) + "ly";
    } else {
      return `Every ${count} ${interval}${count > 1 ? 's' : ''}`;
    }
  };

  // Define price form schema
  const getPriceFormSchema = (price?: any | null) => yup.object({
    name: yup.string().defined().label("Price Name").default(price?.name || ""),
    amount: yup.number().defined().positive().label("Amount (in cents)").default(price?.amount || 1000),
    currency: yup.string().defined().label("Currency").default(price?.currency || "USD"),
    interval: yup.string().nullable().label("Billing Interval").default(price?.interval || null),
    interval_count: yup.number().nullable().label("Interval Count").default(price?.intervalCount || 1),
    active: yup.boolean().defined().label("Active").default(price?.active !== undefined ? price.active : true),
  });

  const priceFormSchema = getPriceFormSchema();

  // Define columns for price table
  const columns: ColumnDef<any>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Name" />,
      cell: ({ row }) => <TextCell>{row.original.name}</TextCell>,
    },
    {
      accessorKey: "amount",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Price" />,
      cell: ({ row }) => <TextCell>{formatAmount(row.original.amount, row.original.currency)}</TextCell>,
    },
    {
      accessorKey: "interval",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Billing Period" />,
      cell: ({ row }) => <TextCell>{formatInterval(row.original.interval, row.original.intervalCount)}</TextCell>,
    },
    {
      accessorKey: "active",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Status" />,
      cell: ({ row }) => (
        <TextCell>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            row.original.active
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
          }`}>
            {row.original.active ? "Active" : "Inactive"}
          </span>
        </TextCell>
      ),
    },
    {
      accessorKey: "stripePriceId",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Stripe Price ID" />,
      cell: ({ row }) => <TextCell>{row.original.stripePriceId || "-"}</TextCell>,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <ActionCell
          items={[
            {
              item: "Edit",
              onClick: () => {
                setSelectedPrice(row.original);
                setIsEditPriceDialogOpen(true);
              },
            },
            {
              item: "Delete",
              danger: true,
              onClick: () => handleDeletePrice(row.original.id),
            },
          ]}
        />
      ),
    },
  ];

  if (!product) {
    return (
      <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 rounded-md text-red-600 dark:text-red-400 text-sm">
        {error || "Product not found"}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <Button
          variant="outline"
          onClick={() => router.push(`/projects/${params.projectId}/products`)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Products
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 rounded-md text-red-600 dark:text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      <SettingCard
        title="Product Details"
        description={`Details for ${product.name}`}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Name</p>
            <p className="mt-1">{product.name}</p>
          </div>
          {product.stripeProductId && (
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Stripe Product ID</p>
              <p className="mt-1">{product.stripeProductId}</p>
            </div>
          )}
          {product.associatedPermissionId && (
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Associated Permission</p>
              <p className="mt-1">{product.associatedPermissionId}</p>
            </div>
          )}
        </div>
      </SettingCard>

      <SettingCard
        title="Pricing"
        description="Manage pricing options for this product"
        className="mt-6"
        actions={
          <Button onClick={() => setIsAddPriceDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Price
          </Button>
        }
      >
        {!stripeConfigured && (
          <div className="mb-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 rounded-md text-amber-600 dark:text-amber-400 text-sm">
            <span className="font-medium">Note:</span> Stripe is not configured for this project. Prices will only be stored locally and not synced with Stripe.
          </div>
        )}

        {prices.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <Typography variant="secondary">
              No pricing options have been added for this product yet.
            </Typography>
          </div>
        ) : (
          <DataTable
            data={prices}
            columns={columns}
            defaultColumnFilters={[]}
            defaultSorting={[{ id: "createdAt", desc: true }]}
          />
        )}
      </SettingCard>

      <SmartFormDialog
        open={isAddPriceDialogOpen}
        onOpenChange={setIsAddPriceDialogOpen}
        title="Add Price"
        description="Create a new pricing option for this product"
        formSchema={priceFormSchema}
        okButton={{ label: "Create" }}
        onSubmit={handleAddPrice}
        cancelButton
      />

      {selectedPrice && (
        <SmartFormDialog
          open={isEditPriceDialogOpen}
          onOpenChange={setIsEditPriceDialogOpen}
          title="Edit Price"
          description="Update pricing option details"
          formSchema={getPriceFormSchema(selectedPrice)}
          okButton={{ label: "Update" }}
          onSubmit={handleUpdatePrice}
          cancelButton
        />
      )}
    </div>
  );
}
