"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { useRouter } from "@/components/router";
import { SettingCard } from "@/components/settings";
import { ActionCell, Button, DataTable, DataTableColumnHeader, TextCell, Typography } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Plus } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import * as yup from "yup";
import { useAdminApp } from "../../use-admin-app";

type Product = {
  id: string,
  name: string,
  stripe_product_id: string | null,
  associated_permission_id: string | null,
  created_at_millis: string,
  project_id: string,
};

type Price = {
  id: string,
  product_id: string,
  name: string,
  amount: number,
  currency: string,
  interval: string | null,
  interval_count: number | null,
  stripe_price_id: string | null,
  active: boolean,
  created_at_millis: string,
};

export default function ProductDetailsClient() {
  const router = useRouter();
  const params = useParams();
  const productId = params.productId as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [prices, setPrices] = useState<Price[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isAddPriceDialogOpen, setIsAddPriceDialogOpen] = useState(false);
  const [isEditPriceDialogOpen, setIsEditPriceDialogOpen] = useState(false);
  const [selectedPrice, setSelectedPrice] = useState<Price | null>(null);

  const stackAdminApp = useAdminApp();
  const projectData = stackAdminApp.useProject();
  const stripeConfig = projectData.config.stripeConfig;
  const stripeConfigured = !!stripeConfig;

  // Fetch product details
  useEffect(() => {
    const fetchProductDetails = async () => {
      try {
        setLoading(true);

        // Fetch product
        const response = await fetch(`/api/latest/finance/products/${productId}`, {
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch product: ${response.statusText}`);
        }

        const productData = await response.json();
        setProduct(productData);

        // Fetch prices for this product
        const pricesResponse = await fetch(`/api/latest/finance/products/${productId}/prices`, {
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!pricesResponse.ok) {
          throw new Error(`Failed to fetch prices: ${pricesResponse.statusText}`);
        }

        const pricesData = await pricesResponse.json();
        setPrices(pricesData.items || []);

      } catch (err) {
        console.error("Error fetching product details:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch product details");
      } finally {
        setLoading(false);
      }
    };

    fetchProductDetails();
  }, [productId]);

  const handleAddPrice = async (values: any) => {
    try {
      const response = await fetch("/api/latest/finance/prices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product_id: productId,
          name: values.name,
          amount: Number(values.amount), // Convert to number
          currency: values.currency,
          interval: values.interval || null,
          interval_count: values.interval ? Number(values.interval_count) : null,
          active: values.active !== undefined ? values.active : true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create price");
      }

      const newPrice = await response.json();

      // Update the prices list
      setPrices((currentPrices) => [newPrice, ...currentPrices]);

    } catch (err) {
      console.error("Error creating price:", err);
      setError(err instanceof Error ? err.message : "Failed to create price");
    }
  };

  const handleUpdatePrice = async (values: any) => {
    if (!selectedPrice) return;

    try {
      const response = await fetch(`/api/latest/finance/prices/${selectedPrice.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: values.name,
          amount: Number(values.amount),
          currency: values.currency,
          interval: values.interval || null,
          interval_count: values.interval ? Number(values.interval_count) : null,
          active: values.active,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to update price");
      }

      const updatedPrice = await response.json();

      // Update the prices list
      setPrices((currentPrices) =>
        currentPrices.map((price) =>
          price.id === updatedPrice.id ? updatedPrice : price
        )
      );

    } catch (err) {
      console.error("Error updating price:", err);
      setError(err instanceof Error ? err.message : "Failed to update price");
    }
  };

  const handleDeletePrice = async (priceId: string) => {
    try {
      const response = await fetch(`/api/latest/finance/prices/${priceId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to delete price");
      }

      // Remove price from the list
      setPrices((currentPrices) =>
        currentPrices.filter((price) => price.id !== priceId)
      );

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
  const getPriceFormSchema = (price?: Price | null) => yup.object({
    name: yup.string().defined().label("Price Name").default(price?.name || ""),
    amount: yup.number().defined().positive().label("Amount (in cents)").default(price?.amount || 1000),
    currency: yup.string().defined().label("Currency").default(price?.currency || "USD"),
    interval: yup.string().nullable().label("Billing Interval").default(price?.interval || null),
    interval_count: yup.number().nullable().label("Interval Count").default(price?.interval_count || 1),
    active: yup.boolean().defined().label("Active").default(price?.active !== undefined ? price.active : true),
  });

  const priceFormSchema = getPriceFormSchema();

  // Define columns for price table
  const columns: ColumnDef<Price>[] = [
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
      cell: ({ row }) => <TextCell>{formatInterval(row.original.interval, row.original.interval_count)}</TextCell>,
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
      accessorKey: "stripe_price_id",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Stripe Price ID" />,
      cell: ({ row }) => <TextCell>{row.original.stripe_price_id || "-"}</TextCell>,
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

  if (loading) {
    return <div className="flex items-center justify-center py-10">Loading product details...</div>;
  }

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
          {product.stripe_product_id && (
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Stripe Product ID</p>
              <p className="mt-1">{product.stripe_product_id}</p>
            </div>
          )}
          {product.associated_permission_id && (
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Associated Permission</p>
              <p className="mt-1">{product.associated_permission_id}</p>
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
            defaultSorting={[{ id: "created_at_millis", desc: true }]}
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
