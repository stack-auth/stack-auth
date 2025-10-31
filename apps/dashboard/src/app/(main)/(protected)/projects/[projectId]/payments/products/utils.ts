import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";

// ============================================================================
// Types
// ============================================================================

export type Product = CompleteConfig['payments']['products'][keyof CompleteConfig['payments']['products']];
export type Price = (Product['prices'] & object)[string];
export type PricesObject = Exclude<Product['prices'], 'include-by-default'>;

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_INTERVAL_UNITS: DayInterval[1][] = ['day', 'week', 'month', 'year'];
export const PRICE_INTERVAL_UNITS: DayInterval[1][] = ['week', 'month', 'year'];

// ============================================================================
// Interval Formatting
// ============================================================================

/**
 * Formats a day interval as a frequency label (e.g., "monthly", "Every 3 weeks")
 */
export function intervalLabel(tuple: DayInterval | undefined): string | null {
  if (!tuple) return null;
  const [count, unit] = tuple;
  if (count === 1) {
    return unit === 'year' ? 'yearly' : unit === 'month' ? 'monthly' : unit === 'week' ? 'weekly' : 'daily';
  }
  const plural = unit + 's';
  return `Every ${count} ${plural}`;
}

/**
 * Formats a day interval as a short label (e.g., "/mo", "/3wk")
 */
export function shortIntervalLabel(interval: DayInterval | 'never'): string {
  if (interval === 'never') return 'once';
  const [count, unit] = interval;
  const map: Record<DayInterval[1], string> = { day: 'd', week: 'wk', month: 'mo', year: 'yr' };
  const suffix = map[unit];
  return `/${count === 1 ? '' : count}${suffix}`;
}

/**
 * Formats a day interval as a duration label (e.g., "7 days", "1 month")
 */
export function freeTrialLabel(tuple: DayInterval | undefined): string | null {
  if (!tuple) return null;
  const [count, unit] = tuple;
  const plural = count === 1 ? unit : unit + 's';
  return `${count} ${plural}`;
}

// ============================================================================
// Price Utilities
// ============================================================================

/**
 * Builds a Price object from current state with all required fields
 */
export function buildPriceUpdate(params: {
  amount: string,
  serverOnly: boolean,
  intervalSelection: 'one-time' | 'custom' | DayInterval[1],
  intervalCount: number,
  priceInterval: DayInterval[1] | undefined,
  freeTrialSelection: 'one-time' | 'custom' | DayInterval[1],
  freeTrialCount: number,
  freeTrialUnit: DayInterval[1] | undefined,
  freeTrial?: DayInterval,
}): Price {
  const { amount, serverOnly, intervalSelection, intervalCount, priceInterval, freeTrialSelection, freeTrialCount, freeTrialUnit, freeTrial } = params;

  const normalized = amount === '' ? '0.00' : (Number.isNaN(parseFloat(amount)) ? '0.00' : parseFloat(amount).toFixed(2));

  const intervalObj = intervalSelection === 'one-time' ? undefined : ([
    intervalSelection === 'custom' ? intervalCount : 1,
    (intervalSelection === 'custom' ? (priceInterval || 'month') : intervalSelection) as DayInterval[1]
  ] as DayInterval);

  const freeTrialObj = freeTrial || (freeTrialSelection === 'one-time' ? undefined : ([
    freeTrialSelection === 'custom' ? freeTrialCount : 1,
    (freeTrialSelection === 'custom' ? (freeTrialUnit || 'day') : freeTrialSelection) as DayInterval[1]
  ] as DayInterval));

  return {
    USD: normalized,
    serverOnly,
    ...(intervalObj ? { interval: intervalObj } : {}),
    ...(freeTrialObj ? { freeTrial: freeTrialObj } : {}),
  };
}

/**
 * Converts prices object to array format, handling 'include-by-default' case
 */
export function getPricesObject(draft: Product): PricesObject {
  if (draft.prices === 'include-by-default') {
    return {
      "free": {
        USD: '0.00',
        serverOnly: false,
      },
    };
  }
  return draft.prices;
}

// ============================================================================
// ID Validation & Generation
// ============================================================================

const ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * Validates if an ID matches the required pattern
 */
export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/**
 * Generates a unique ID with a given prefix
 */
export function generateUniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).slice(2, 8)}`;
}

/**
 * Sanitizes user input into a valid ID format (lowercase, hyphenated)
 */
export function sanitizeId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_\-]/g, '-');
}
