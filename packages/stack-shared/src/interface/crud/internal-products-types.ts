// Type definitions for the internal product endpoints
export type ProductAdminRead = {
  id: string,
  name: string,
  stripe_product_id: string | null,
  associated_permission_id: string | null,
  created_at_millis: string,
  project_id: string,
};

export type ProductAdminCreate = {
  name: string,
  stripe_product_id?: string | null,
  associated_permission_id?: string | null,
  project_id: string,
};

export type ProductAdminUpdate = {
  name?: string,
  stripe_product_id?: string | null,
  associated_permission_id?: string | null,
};

export type ProductAdminList = {
  items: ProductAdminRead[],
};
