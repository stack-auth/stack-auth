export type AdminPrice = {
  id: string,
  productId: string,
  name: string,
  amount: number,
  currency: string,
  interval: string | null,
  intervalCount: number | null,
  stripePriceId: string | null,
  active: boolean,
  isDefault: boolean,
  createdAt: Date,
};

export type AdminPriceCreateOptions = {
  productId: string,
  name: string,
  amount: number,
  currency: string,
  interval?: string | null,
  intervalCount?: number | null,
  active?: boolean,
  isDefault?: boolean,
};

export type AdminPriceUpdateOptions = {
  name?: string,
  amount?: number,
  currency?: string,
  interval?: string | null,
  intervalCount?: number | null,
  active?: boolean,
  isDefault?: boolean,
};

export function adminPriceCreateOptionsToCrud(options: AdminPriceCreateOptions): {
  product_id: string,
  name: string,
  amount: number,
  currency: string,
  interval: string | null,
  interval_count: number | null,
  active?: boolean,
  is_default?: boolean,
} {
  return {
    product_id: options.productId,
    name: options.name,
    amount: options.amount,
    currency: options.currency,
    interval: options.interval ?? null,
    interval_count: options.intervalCount ?? null,
    active: options.active,
    is_default: options.isDefault,
  };
}

export function adminPriceUpdateOptionsToCrud(options: AdminPriceUpdateOptions): {
  name?: string,
  amount?: number,
  currency?: string,
  interval?: string | null,
  interval_count?: number | null,
  active?: boolean,
  is_default?: boolean,
} {
  return {
    name: options.name,
    amount: options.amount,
    currency: options.currency,
    interval: options.interval,
    interval_count: options.intervalCount,
    active: options.active,
    is_default: options.isDefault,
  };
}
