"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SettingCard } from "@/components/settings";
import { ActionCell, Button, DataTable, DataTableColumnHeader, TextCell, Typography } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import { Package2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type Product = {
  id: string;
  name: string;
  stripe_product_id: string | null;
  associated_permission_id: string | null;
  created_at_millis: string;
  project_id: string;
};

export default function PageClient() {
  const [isAddProductDialogOpen, setIsAddProductDialogOpen] = useState(false);
  const [isEditProductDialogOpen, setIsEditProductDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const stripeConfig = project.config.stripeConfig;
  const stripeConfigured = !!stripeConfig;

  const fetchProducts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/latest/internal/payments/products`, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Error fetching products: ${response.status}`);
      }
      const data = await response.json();
      setProducts(data.items || []);
    } catch (err) {
      console.error("Error fetching products:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch products");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleAddProduct = async (values: any) => {
    try {
      const response = await fetch(`/api/latest/internal/payments/products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: values.name,
          stripe_product_id: values.stripe_product_id || null,
          associated_permission_id: values.associated_permission_id || null,
          project_id: project.id,
        }),
      });

      if (!response.ok) {
        throw new Error(`Error creating product: ${response.status}`);
      }

      // Refresh products list
      await fetchProducts();
    } catch (err) {
      console.error("Error creating product:", err);
      setError(err instanceof Error ? err.message : "Failed to create product");
    }
  };

  const handleUpdateProduct = async (values: any) => {
    if (!selectedProduct) return;

    try {
      const response = await fetch(`/api/latest/internal/payments/products/${selectedProduct.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: values.name,
          stripe_product_id: values.stripe_product_id || null,
          associated_permission_id: values.associated_permission_id || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Error updating product: ${response.status}`);
      }

      // Refresh products list
      await fetchProducts();
    } catch (err) {
      console.error("Error updating product:", err);
      setError(err instanceof Error ? err.message : "Failed to update product");
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    try {
      const response = await fetch(`/api/latest/internal/payments/products/${productId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Error deleting product: ${response.status}`);
      }

      // Refresh products list
      await fetchProducts();
    } catch (err) {
      console.error("Error deleting product:", err);
      setError(err instanceof Error ? err.message : "Failed to delete product");
    }
  };

  const columns: ColumnDef<Product>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Name" />,
      cell: ({ row }) => <TextCell>{row.original.name}</TextCell>,
    },
    {
      accessorKey: "stripe_product_id",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Stripe Product ID" />,
      cell: ({ row }) => <TextCell>{row.original.stripe_product_id || "-"}</TextCell>,
    },
    {
      accessorKey: "associated_permission_id",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Associated Permission" />,
      cell: ({ row }) => <TextCell>{row.original.associated_permission_id || "-"}</TextCell>,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <ActionCell
          items={[
            {
              item: "Edit",
              onClick: () => {
                setSelectedProduct(row.original);
                setIsEditProductDialogOpen(true);
              },
            },
            {
              item: "Delete",
              danger: true,
              onClick: () => handleDeleteProduct(row.original.id),
            },
          ]}
        />
      ),
    },
  ];

  const getProductFormSchema = (product?: Product | null) => yup.object({
    name: yup.string().required().label("Product Name").default(product?.name || ""),
    stripe_product_id: yup.string().nullable().label("Stripe Product ID").default(product?.stripe_product_id),
    associated_permission_id: yup.string().nullable().label("Associated Permission ID").default(product?.associated_permission_id),
  });
  
  const productFormSchema = getProductFormSchema();

  return (
    <PageLayout
      title="Products"
      description="Manage products for your application"
      actions={
        <Button onClick={() => setIsAddProductDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Product
        </Button>
      }
    >
      {error && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 rounded-md text-red-600 dark:text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {!stripeConfigured && (
        <SettingCard 
          title="Stripe Configuration Required" 
          description="Configure Stripe to enable full product functionality"
          actions={
            <Button onClick={(e) => { 
              e.preventDefault();
              window.location.href = `/projects/${project.id}/payments`;
            }}>
              Configure Stripe
            </Button>
          }
        >
          <div className="flex items-center gap-3">
            <Package2 />
            <Typography>
              For full product functionality, including syncing with Stripe products and subscriptions, 
              you need to configure Stripe in the Payments section.
            </Typography>
          </div>
        </SettingCard>
      )}

      <SettingCard
        title="Products"
        description="Manage your application's products"
      >
        {isLoading ? (
          <div className="py-4">Loading products...</div>
        ) : (
          <DataTable
            data={products}
            columns={columns}
            defaultColumnFilters={[]}
            defaultSorting={[{ id: "name", desc: false }]}
            toolbarRender={() => (
              <div className="text-center py-8">
                <Package2 className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <Typography className="font-semibold mb-2">No products found</Typography>
                <Typography variant="secondary">Create your first product to get started</Typography>
              </div>
            )}
          />
        )}
      </SettingCard>

      <SmartFormDialog
        open={isAddProductDialogOpen}
        onOpenChange={setIsAddProductDialogOpen}
        title="Add Product"
        description="Create a new product for your application"
        formSchema={productFormSchema}
        okButton={{ label: "Create" }}
        onSubmit={handleAddProduct}
        cancelButton
      />

      {selectedProduct && (
        <SmartFormDialog
          open={isEditProductDialogOpen}
          onOpenChange={setIsEditProductDialogOpen}
          title="Edit Product"
          description="Update product details"
          formSchema={getProductFormSchema(selectedProduct)}
          okButton={{ label: "Update" }}
          onSubmit={handleUpdateProduct}
          cancelButton
        />
      )}
    </PageLayout>
  );
}