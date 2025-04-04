import { ProductAdminCreate, ProductAdminUpdate } from "@stackframe/stack-shared/dist/interface/crud/internal-products-types";

export type AdminProduct = {
  id: string,
  name: string,
  stripeProductId: string | null,
  associatedPermissionId: string | null,
  createdAt: Date,
};

export type AdminProductCreateOptions = {
  name: string,
  stripeProductId?: string | null,
  associatedPermissionId?: string | null,
};

export type AdminProductUpdateOptions = {
  name?: string,
  stripeProductId?: string | null,
  associatedPermissionId?: string | null,
};

export function adminProductCreateOptionsToCrud(options: AdminProductCreateOptions): Omit<ProductAdminCreate, 'project_id'> {
  return {
    name: options.name,
    stripe_product_id: options.stripeProductId ?? null,
    associated_permission_id: options.associatedPermissionId ?? null,
  };
}

export function adminProductUpdateOptionsToCrud(options: AdminProductUpdateOptions): ProductAdminUpdate {
  return {
    name: options.name,
    stripe_product_id: options.stripeProductId,
    associated_permission_id: options.associatedPermissionId,
  };
}
