// Public transaction entry indexes used when constructing refund back-references.
// The corresponding Bulldozer schema emits hidden/internal entries too, but the
// public API mapping exposes product grants at index 0 for both source types.
export const SUBSCRIPTION_START_PRODUCT_GRANT_ENTRY_INDEX = 0;
export const ONE_TIME_PURCHASE_PRODUCT_GRANT_ENTRY_INDEX = 0;
