import type { InferType } from "yup";
import {
  customerTypeSchema,
  inlineProductSchema,
  yupRecord,
  yupArray,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
  yupUnion,
} from "../../schema-fields";

const chargedAmountSchema = yupRecord(yupString(), yupString().defined()).test(
  "at-least-one-currency",
  "charged_amount must include at least one currency amount",
  (value) => Object.values(value).some((amount) => typeof amount === "string"),
).defined();

const netAmountSchema = yupObject({
  USD: yupString().defined(),
}).defined();

const transactionEntryMoneyTransferSchema = yupObject({
  type: yupString().oneOf(["money_transfer"]).defined(),
  adjusted_transaction_id: yupString().nullable().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  charged_amount: chargedAmountSchema,
  net_amount: netAmountSchema,
}).defined();

const transactionEntryItemQuantityChangeSchema = yupObject({
  type: yupString().oneOf(["item_quantity_change"]).defined(),
  adjusted_transaction_id: yupString().nullable().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  item_id: yupString().defined(),
  quantity: yupNumber().defined(),
}).defined();

const transactionEntryProductGrantSchema = yupObject({
  type: yupString().oneOf(["product_grant"]).defined(),
  adjusted_transaction_id: yupString().nullable().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  product_id: yupString().nullable().defined(),
  product: inlineProductSchema.defined(),
  price_id: yupString().nullable().defined(),
  quantity: yupNumber().defined(),
  subscription_id: yupString().optional(),
  one_time_purchase_id: yupString().optional(),
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

const transactionEntryActiveSubStartSchema = yupObject({
  type: yupString().oneOf(["active_sub_start"]).defined(),
  adjusted_transaction_id: yupString().nullable().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  subscription_id: yupString().defined(),
  product_id: yupString().nullable().defined(),
  price_id: yupString().nullable().defined(),
}).defined();

const transactionEntryActiveSubChangeSchema = yupObject({
  type: yupString().oneOf(["active_sub_change"]).defined(),
  adjusted_transaction_id: yupString().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  subscription_id: yupString().defined(),
  old_product_id: yupString().nullable().defined(),
  new_product_id: yupString().nullable().defined(),
  old_price_id: yupString().nullable().defined(),
  new_price_id: yupString().nullable().defined(),
}).defined();

const transactionEntryActiveSubStopSchema = yupObject({
  type: yupString().oneOf(["active_sub_stop"]).defined(),
  adjusted_transaction_id: yupString().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  subscription_id: yupString().defined(),
}).defined();

const transactionEntryProductRevocationSchema = yupObject({
  type: yupString().oneOf(["product_revocation"]).defined(),
  adjusted_transaction_id: yupString().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).defined(),
  quantity: yupNumber().defined(),
}).defined();

const transactionEntryItemQuantityExpireSchema = yupObject({
  type: yupString().oneOf(["item_quantity_expire"]).defined(),
  adjusted_transaction_id: yupString().defined(),
  adjusted_entry_index: yupNumber().integer().min(0).defined(),
  item_id: yupString().defined(),
  quantity: yupNumber().defined(),
}).defined();

export const transactionEntrySchema = yupUnion(
  transactionEntryActiveSubStartSchema,
  transactionEntryActiveSubChangeSchema,
  transactionEntryActiveSubStopSchema,
  transactionEntryMoneyTransferSchema,
  transactionEntryItemQuantityChangeSchema,
  transactionEntryItemQuantityExpireSchema,
  transactionEntryProductGrantSchema,
  transactionEntryProductRevocationSchema,
).defined();

export type TransactionEntry = InferType<typeof transactionEntrySchema>;

export const TRANSACTION_TYPES = [
  "new-stripe-sub",
  "stripe-resub",
  "stripe-one-time",
  "stripe-expire",
  "stripe-refund",
  "sub-change",
  "stripe-sub-cancel",
  "item-quantity-renewal",
  "purchase",
  "subscription-cancellation",
  "subscription-renewal",
  "manual-item-quantity-change",
  "chargeback", // todo
  "product-change", // todo
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const transactionSchema = yupObject({
  id: yupString().defined(),
  created_at_millis: yupNumber().defined(),
  effective_at_millis: yupNumber().defined(),
  type: yupString().oneOf(TRANSACTION_TYPES).nullable().defined(),
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
