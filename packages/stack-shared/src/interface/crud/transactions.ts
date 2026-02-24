import type { InferType } from "yup";
import {
  customerTypeSchema,
  inlineProductSchema,
  moneyAmountSchema,
  yupArray,
  yupBoolean,
  yupNumber,
  yupObject,
  yupRecord,
  yupString,
  yupUnion,
} from "../../schema-fields";
import { SUPPORTED_CURRENCIES } from "../../utils/currency-constants";
import { typedFromEntries } from "../../utils/objects";
import { throwErr } from "../../utils/errors";


const USD_CURRENCY = SUPPORTED_CURRENCIES.find((currency) => currency.code === "USD") ?? throwErr("USD currency configuration missing in SUPPORTED_CURRENCIES");

const chargedAmountSchema = yupObject({
  ...typedFromEntries(SUPPORTED_CURRENCIES.map((currency) => [currency.code, moneyAmountSchema(currency).optional()])),
}).noUnknown(true).test("at-least-one-currency", "charged_amount must include at least one currency amount", (value) => {
  return Object.values(value).some((amount) => typeof amount === "string");
}).defined();

const netAmountSchema = yupObject({
  USD: moneyAmountSchema(USD_CURRENCY).defined(),
}).noUnknown(true).defined();

const transactionEntryMoneyTransferSchema = yupObject({
  type: yupString().oneOf(["money-transfer"]).defined(),
  adjusted_transaction_id: yupString().nullable().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  charged_amount: chargedAmountSchema,
  net_amount: netAmountSchema,
}).defined();

const transactionEntryItemQuantityChangeSchema = yupObject({
  type: yupString().oneOf(["item-quantity-change"]).defined(),
  adjusted_transaction_id: yupString().nullable().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  item_id: yupString().defined(),
  quantity: yupNumber().defined(),
}).defined();

const transactionEntryItemQuantityExpireSchema = yupObject({
  type: yupString().oneOf(["item-quantity-expire"]).defined(),
  adjusted_transaction_id: yupString().nullable().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  item_id: yupString().defined(),
  quantity: yupNumber().defined(),
}).defined();

const transactionEntryProductGrantSchema = yupObject({
  type: yupString().oneOf(["product-grant"]).defined(),
  adjusted_transaction_id: yupString().nullable().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  product_id: yupString().nullable().defined(),
  product: inlineProductSchema.defined(),
  price_id: yupString().nullable().defined(),
  quantity: yupNumber().defined(),
  cycle_anchor: yupNumber().defined(),
  subscription_id: yupString().optional(),
  one_time_purchase_id: yupString().optional(),
  item_quantity_change_indices: yupRecord(yupString(), yupNumber().integer().min(0)).optional(),
}).test(
  "exclusive-reference",
  "subscription_id and one_time_purchase_id cannot both be set",
  (value, context) => {
    if (value.subscription_id != null && value.one_time_purchase_id != null) {
      return context.createError({
        message: "subscription_id and one_time_purchase_id cannot both be set",
      });
    }
    return true;
  },
).defined();

const transactionEntryProductRevocationSchema = yupObject({
  type: yupString().oneOf(["product-revocation"]).defined(),
  adjusted_transaction_id: yupString().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  quantity: yupNumber().defined(),
}).defined();

const transactionEntryProductRevocationReversalSchema = yupObject({
  type: yupString().oneOf(["product-revocation-reversal"]).defined(),
  adjusted_transaction_id: yupString().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).defined(),
  quantity: yupNumber().defined(),
}).defined();

const transactionEntryActiveSubscriptionStartSchema = yupObject({
  type: yupString().oneOf(["active-subscription-start"]).defined(),
  adjusted_transaction_id: yupString().nullable().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  subscription_id: yupString().defined(),
  product_id: yupString().nullable().defined(),
  product: inlineProductSchema.defined(),
}).defined();

const transactionEntryActiveSubscriptionStopSchema = yupObject({
  type: yupString().oneOf(["active-subscription-stop"]).defined(),
  adjusted_transaction_id: yupString().nullable().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  subscription_id: yupString().defined(),
}).defined();

const transactionEntryActiveSubscriptionChangeSchema = yupObject({
  type: yupString().oneOf(["active-subscription-change"]).defined(),
  adjusted_transaction_id: yupString().nullable().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  subscription_id: yupString().defined(),
  change_type: yupString().oneOf(["cancel", "reactivate", "switch"]).defined(),
  product_id: yupString().nullable().optional(),
  product: inlineProductSchema.optional(),
}).defined();

const transactionEntryDefaultProductsChangeSchema = yupObject({
  type: yupString().oneOf(["default-products-change"]).defined(),
  snapshot: yupRecord(
    yupString(),
    inlineProductSchema,
  ).defined(),
}).defined();

const transactionEntryDefaultProductItemGrantSchema = yupObject({
  type: yupString().oneOf(["default-product-item-grant"]).defined(),
  adjusted_transaction_id: yupString().nullable().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
  product_id: yupString().defined(),
  item_id: yupString().defined(),
  quantity: yupNumber().defined(),
  expires_when_repeated: yupBoolean().defined(),
}).defined();

const transactionEntryDefaultProductItemChangeSchema = yupObject({
  type: yupString().oneOf(["default-product-item-change"]).defined(),
  adjusted_transaction_id: yupString().nullable().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
  product_id: yupString().defined(),
  item_id: yupString().defined(),
  quantity: yupNumber().defined(),
  expires_when_repeated: yupBoolean().defined(),
}).defined();

const transactionEntryDefaultProductItemExpireSchema = yupObject({
  type: yupString().oneOf(["default-product-item-expire"]).defined(),
  adjusted_transaction_id: yupString().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).defined(),
  product_id: yupString().defined(),
  item_id: yupString().defined(),
  quantity: yupNumber().defined(),
}).defined();

export const transactionEntrySchema = yupUnion(
  transactionEntryMoneyTransferSchema,
  transactionEntryItemQuantityChangeSchema,
  transactionEntryItemQuantityExpireSchema,
  transactionEntryProductGrantSchema,
  transactionEntryProductRevocationSchema,
  transactionEntryProductRevocationReversalSchema,
  transactionEntryActiveSubscriptionStartSchema,
  transactionEntryActiveSubscriptionStopSchema,
  transactionEntryActiveSubscriptionChangeSchema,
  transactionEntryDefaultProductsChangeSchema,
  transactionEntryDefaultProductItemGrantSchema,
  transactionEntryDefaultProductItemChangeSchema,
  transactionEntryDefaultProductItemExpireSchema,
).defined();

export type TransactionEntry = InferType<typeof transactionEntrySchema>;

export const TRANSACTION_TYPES = [
  "subscription-start",
  "subscription-renewal",
  "one-time-purchase",
  "subscription-end",
  "purchase-refund",
  "manual-item-quantity-change",
  "subscription-cancel",
  "subscription-reactivation",
  "subscription-change",
  "chargeback",
  "product-version-change",
  "item-grant-renewal",
  "default-products-change",
  "default-product-item-grant-repeat",
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const transactionSchema = yupObject({
  id: yupString().defined(),
  created_at_millis: yupNumber().defined(),
  effective_at_millis: yupNumber().defined(),
  type: yupString().oneOf(TRANSACTION_TYPES).nullable().defined(),
  details: yupObject({}).noUnknown(false).optional(),
  entries: yupArray(transactionEntrySchema).defined(),
  adjusted_by: yupArray(
    yupObject({
      transaction_id: yupString().defined(),
      entry_index: yupNumber().integer().min(0).defined(),
    }).defined(),
  ).defined(),
  test_mode: yupBoolean().defined(),
}).defined();

export type Transaction = InferType<typeof transactionSchema>;
