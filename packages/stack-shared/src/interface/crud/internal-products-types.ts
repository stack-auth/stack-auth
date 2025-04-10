// Type definitions for the internal product endpoints
export type PriceAdminRead = {
  id: string,
  product_id: string,
  name: string,
  amount: number,
  currency: string,
  interval: string | null,
  interval_count: number | null,
  stripe_price_id: string | null,
  active: boolean,
  is_default: boolean,
  created_at_millis: string,
};

export type ProductAdminRead = {
  id: string,
  name: string,
  stripe_product_id: string | null,
  associated_permission_id: string | null,
  created_at_millis: string,
  project_id: string,
  prices?: PriceAdminRead[],
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
