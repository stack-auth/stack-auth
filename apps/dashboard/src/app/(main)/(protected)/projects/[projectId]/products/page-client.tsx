"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SettingCard } from "@/components/settings";
import { ActionCell, Button, DataTable, DataTableColumnHeader, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, TextCell, Typography } from "@stackframe/stack-ui";
import { useEffect, useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { Package2 } from "lucide-react";

type Product = {
  id: string;
  name: string;
  stripe_product_id: string | null;
  associated_permission_id: string | null;
  created_at_millis: string;
};

export default function PageClient() {
  const [isAddProductDialogOpen, setIsAddProductDialogOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const stripeConfig = project.config.stripeConfig;
  const stripeConfigured = !!stripeConfig;

  const fetchProducts = async () => {
    try {
      setIsLoading(true);
      const response = await stackAdminApp.listProducts();
      setProducts(response.items);
      setError(null);
    } catch (err) {
      console.error('Error fetching products:', err);
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const columns = [
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Name" />,
      cell: ({ row }) => <TextCell>{row.original.name}</TextCell>,
    },
    {
      accessorKey: "stripe_product_id",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Stripe Product ID" />,
      cell: ({ row }) => (
        <TextCell size={200}>{row.original.stripe_product_id || "Not linked to Stripe"}</TextCell>
      ),
    },
    {
      accessorKey: "associated_permission_id",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Permission" />,
      cell: ({ row }) => {
        if (!row.original.associated_permission_id) {
          return <TextCell>None</TextCell>;
        }
        return <PermissionCell permissionId={row.original.associated_permission_id} />;
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <ActionCell
          items={[
            {
              item: "Edit",
              onClick: () => {
                handleEditProduct(row.original);
              },
            },
            {
              item: "Delete",
              danger: true,
              onClick: () => {
                handleDeleteProduct(row.original.id);
              },
            },
          ]}
        />
      ),
    },
  ];

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isEditProductDialogOpen, setIsEditProductDialogOpen] = useState(false);
  const [isDeleteProductDialogOpen, setIsDeleteProductDialogOpen] = useState(false);
  const [productIdToDelete, setProductIdToDelete] = useState<string | null>(null);

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    setIsEditProductDialogOpen(true);
  };

  const handleDeleteProduct = (productId: string) => {
    setProductIdToDelete(productId);
    setIsDeleteProductDialogOpen(true);
  };

  return (
    <PageLayout
      title="Products"
      description="Manage your subscription products and link them to permissions"
      actions={
        <Button onClick={() => setIsAddProductDialogOpen(true)}>
          Add Product
        </Button>
      }
    >
      {!stripeConfigured && (
        <SettingCard
          title="Stripe Integration Required"
          description="Configure Stripe to fully utilize product features"
          actions={
            <Button onClick={() => window.location.href = `/projects/${project.id}/payments`}>
              Configure Stripe
            </Button>
          }
        >
          <div className="flex items-center gap-3">
            <Package2 />
            <Typography>
              For complete product functionality, including subscription management, connect your application to Stripe on the Payments page.
            </Typography>
          </div>
        </SettingCard>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 rounded-md text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="bg-card border rounded-md">
        <div className="p-4">
          <Typography type="h3">Products</Typography>
          <Typography variant="secondary">
            Create products and link them to permissions to enable subscription-based access control
          </Typography>
        </div>
        <DataTable
          data={products}
          columns={columns}
          defaultColumnFilters={[]}
          defaultSorting={[{ id: "name", desc: false }]}
          emptyStateProps={{
            title: "No products found",
            description: "Add a product to get started",
          }}
          loadingStateProps={{
            visible: isLoading,
          }}
        />
      </div>

      <AddProductDialog
        open={isAddProductDialogOpen}
        onOpenChange={setIsAddProductDialogOpen}
        onProductAdded={fetchProducts}
        projectId={project.id}
      />

      {editingProduct && (
        <EditProductDialog
          open={isEditProductDialogOpen}
          onOpenChange={setIsEditProductDialogOpen}
          product={editingProduct}
          onProductUpdated={fetchProducts}
        />
      )}

      <DeleteProductDialog
        open={isDeleteProductDialogOpen}
        onOpenChange={setIsDeleteProductDialogOpen}
        productId={productIdToDelete}
        onProductDeleted={fetchProducts}
      />
    </PageLayout>
  );
}

function PermissionCell({ permissionId }: { permissionId: string }) {
  const stackAdminApp = useAdminApp();
  const [permissionName, setPermissionName] = useState<string | null>(null);

  useEffect(() => {
    const fetchPermission = async () => {
      try {
        const permission = await stackAdminApp.getPermission(permissionId);
        setPermissionName(permission.name);
      } catch (error) {
        console.error('Error fetching permission:', error);
        setPermissionName('Unknown');
      }
    };

    fetchPermission();
  }, [permissionId, stackAdminApp]);

  return <TextCell>{permissionName || 'Loading...'}</TextCell>;
}

function AddProductDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProductAdded: () => void;
  projectId: string;
}) {
  const stackAdminApp = useAdminApp();
  const [permissions, setPermissions] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(true);

  useEffect(() => {
    const fetchPermissions = async () => {
      try {
        setIsLoadingPermissions(true);
        const response = await stackAdminApp.listProjectPermissions();
        setPermissions(response.items);
      } catch (error) {
        console.error('Error fetching permissions:', error);
      } finally {
        setIsLoadingPermissions(false);
      }
    };

    if (props.open) {
      fetchPermissions();
    }
  }, [props.open, stackAdminApp]);

  const formSchema = yup.object({
    name: yup.string().required().label("Product Name"),
    stripe_product_id: yup.string().nullable().label("Stripe Product ID"),
    associated_permission_id: yup.string().nullable().label("Associated Permission"),
  });

  return (
    <SmartFormDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Add Product"
      description="Create a new product and optionally link it to a Stripe product and permission"
      formSchema={formSchema}
      okButton={{ label: "Create" }}
      onSubmit={async (values) => {
        try {
          await stackAdminApp.createProduct({
            name: values.name,
            stripe_product_id: values.stripe_product_id || null,
            associated_permission_id: values.associated_permission_id || null,
            project_id: props.projectId,
          });
          props.onProductAdded();
        } catch (error) {
          console.error('Error creating product:', error);
          throw error;
        }
      }}
      cancelButton
    >
      {(register, formState) => (
        <>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Product Name
              </label>
              <input
                {...register("name")}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Pro Plan"
              />
              {formState.errors.name && (
                <p className="text-red-500 text-sm mt-1">{formState.errors.name.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Stripe Product ID (Optional)
              </label>
              <input
                {...register("stripe_product_id")}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="prod_..."
              />
              {formState.errors.stripe_product_id && (
                <p className="text-red-500 text-sm mt-1">{formState.errors.stripe_product_id.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Associated Permission (Optional)
              </label>
              <select
                {...register("associated_permission_id")}
                className="w-full px-3 py-2 border rounded-md"
                disabled={isLoadingPermissions}
              >
                <option value="">None</option>
                {permissions.map((permission) => (
                  <option key={permission.id} value={permission.id}>
                    {permission.name}
                  </option>
                ))}
              </select>
              {formState.errors.associated_permission_id && (
                <p className="text-red-500 text-sm mt-1">{formState.errors.associated_permission_id.message}</p>
              )}
            </div>
          </div>
        </>
      )}
    </SmartFormDialog>
  );
}

function EditProductDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  onProductUpdated: () => void;
}) {
  const stackAdminApp = useAdminApp();
  const [permissions, setPermissions] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(true);

  useEffect(() => {
    const fetchPermissions = async () => {
      try {
        setIsLoadingPermissions(true);
        const response = await stackAdminApp.listProjectPermissions();
        setPermissions(response.items);
      } catch (error) {
        console.error('Error fetching permissions:', error);
      } finally {
        setIsLoadingPermissions(false);
      }
    };

    if (props.open) {
      fetchPermissions();
    }
  }, [props.open, stackAdminApp]);

  const formSchema = yup.object({
    name: yup.string().required().label("Product Name"),
    stripe_product_id: yup.string().nullable().label("Stripe Product ID"),
    associated_permission_id: yup.string().nullable().label("Associated Permission"),
  });

  return (
    <SmartFormDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Edit Product"
      description="Update product details and integrations"
      formSchema={formSchema}
      defaultValues={{
        name: props.product.name,
        stripe_product_id: props.product.stripe_product_id || "",
        associated_permission_id: props.product.associated_permission_id || "",
      }}
      okButton={{ label: "Update" }}
      onSubmit={async (values) => {
        try {
          await stackAdminApp.updateProduct(props.product.id, {
            name: values.name,
            stripe_product_id: values.stripe_product_id || null,
            associated_permission_id: values.associated_permission_id || null,
          });
          props.onProductUpdated();
        } catch (error) {
          console.error('Error updating product:', error);
          throw error;
        }
      }}
      cancelButton
    >
      {(register, formState) => (
        <>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Product Name
              </label>
              <input
                {...register("name")}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Pro Plan"
              />
              {formState.errors.name && (
                <p className="text-red-500 text-sm mt-1">{formState.errors.name.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Stripe Product ID (Optional)
              </label>
              <input
                {...register("stripe_product_id")}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="prod_..."
              />
              {formState.errors.stripe_product_id && (
                <p className="text-red-500 text-sm mt-1">{formState.errors.stripe_product_id.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Associated Permission (Optional)
              </label>
              <select
                {...register("associated_permission_id")}
                className="w-full px-3 py-2 border rounded-md"
                disabled={isLoadingPermissions}
              >
                <option value="">None</option>
                {permissions.map((permission) => (
                  <option key={permission.id} value={permission.id}>
                    {permission.name}
                  </option>
                ))}
              </select>
              {formState.errors.associated_permission_id && (
                <p className="text-red-500 text-sm mt-1">{formState.errors.associated_permission_id.message}</p>
              )}
            </div>
          </div>
        </>
      )}
    </SmartFormDialog>
  );
}

function DeleteProductDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string | null;
  onProductDeleted: () => void;
}) {
  const stackAdminApp = useAdminApp();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!props.productId) return;
    
    try {
      setIsDeleting(true);
      await stackAdminApp.deleteProduct(props.productId);
      props.onProductDeleted();
      props.onOpenChange(false);
    } catch (error) {
      console.error('Error deleting product:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Product</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this product? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => props.onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}