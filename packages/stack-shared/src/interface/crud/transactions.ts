import type { InferType } from "yup";
import * as yup from "yup";
import {
  customerTypeSchema,
  inlineProductSchema,
  yupArray,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
  yupUnion,
} from "../../schema-fields";
import { SUPPORTED_CURRENCIES, type Currency, type MoneyAmount } from "../../utils/currency-constants";
import { typedFromEntries } from "../../utils/objects";
import { throwErr } from "../../utils/errors";

type AdjustmentMode = "optional" | "required" | "forbidden";

const USD_CURRENCY = SUPPORTED_CURRENCIES.find((currency) => currency.code === "USD") ?? throwErr("USD currency configuration missing in SUPPORTED_CURRENCIES");

function signedMoneyAmountSchema(currency: Currency) {
  return yupString<MoneyAmount>().test("signed-money-amount", "Invalid money amount", (value, context) => {
    if (value == null) return true;
    const regex = /^-?([0-9]+)(\.([0-9]+))?$/;
    const match = value.match(regex);
    if (!match) {
      return context.createError({ message: "Money amount must be in the format of <number> or <number>.<number>" });
    }
    const whole = match[1];
    const decimals = match[3];
    if (decimals && decimals.length > currency.decimals) {
      return context.createError({ message: `Too many decimals; ${currency.code} only has ${currency.decimals} decimals` });
    }
    if (whole !== "0" && whole.startsWith("0")) {
      return context.createError({ message: "Money amount must not have leading zeros" });
    }
    return true;
  });
}

function enforceAdjustmentConstraint<T extends yup.AnySchema>(
  schema: T,
  mode: AdjustmentMode,
): T {
  return schema.test("adjustment-pair", "Invalid adjustment reference", (value, context) => {
    if (!value) return true;
    const hasId = value.adjusted_transaction_id != null;
    const hasIndex = value.adjusted_entry_index != null;

    switch (mode) {
      case "optional": {
        if (hasId !== hasIndex) {
          return context.createError({
            message: "adjusted_transaction_id and adjusted_entry_index must either both be null or both be provided",
          });
        }
        return true;
      }
      case "required": {
        if (!hasId || !hasIndex) {
          return context.createError({
            message: "adjusted_transaction_id and adjusted_entry_index must be provided for adjustment entries",
          });
        }
        return true;
      }
      case "forbidden": {
        if (hasId || hasIndex) {
          return context.createError({
            message: "adjusted_transaction_id and adjusted_entry_index must not be set for this entry type",
          });
        }
        return true;
      }
      default: {
        return true;
      }
    }
  });
}

const chargedAmountSchema = yupObject({
  ...typedFromEntries(SUPPORTED_CURRENCIES.map((currency) => [currency.code, signedMoneyAmountSchema(currency).optional()])),
}).noUnknown(true).test("at-least-one-currency", "charged_amount must include at least one currency amount", (value) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- yup's runtime validation can provide undefined values here
  if (!value) return false;
  return Object.values(value).some((amount) => typeof amount === "string");
}).defined();

const netAmountSchema = yupObject({
  USD: signedMoneyAmountSchema(USD_CURRENCY).defined(),
}).noUnknown(true).defined();

const transactionEntryMoneyTransferSchema = enforceAdjustmentConstraint(
  yupObject({
    type: yupString().oneOf(["money_transfer"]).defined(),
    adjusted_transaction_id: yupString().nullable().defined(),
    adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
    customer_type: customerTypeSchema.defined(),
    customer_id: yupString().defined(),
    charged_amount: chargedAmountSchema,
    net_amount: netAmountSchema,
  }).defined(),
  "optional",
);

const transactionEntryItemQuantityChangeSchema = enforceAdjustmentConstraint(
  yupObject({
    type: yupString().oneOf(["item_quantity_change"]).defined(),
    adjusted_transaction_id: yupString().nullable().defined(),
    adjusted_entry_index: yupNumber().integer().min(0).nullable().defined(),
    customer_type: customerTypeSchema.defined(),
    customer_id: yupString().defined(),
    item_id: yupString().defined(),
    quantity: yupNumber().defined(),
  }).defined(),
  "optional",
);

const transactionEntryProductGrantSchema = enforceAdjustmentConstraint(
  yupObject({
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
  ).defined(),
  "forbidden",
);

const transactionEntryProductRevocationSchema = enforceAdjustmentConstraint(
  yupObject({
    type: yupString().oneOf(["product_revocation"]).defined(),
    adjusted_transaction_id: yupString().defined(),
    adjusted_entry_index: yupNumber().integer().min(0).defined(),
    quantity: yupNumber().defined(),
  }).defined(),
  "required",
);

const transactionEntryProductRevocationReversalSchema = enforceAdjustmentConstraint(
  yupObject({
    type: yupString().oneOf(["product_revocation_reversal"]).defined(),
    adjusted_transaction_id: yupString().defined(),
    adjusted_entry_index: yupNumber().integer().min(0).defined(),
    quantity: yupNumber().defined(),
  }).defined(),
  "required",
);

export const transactionEntrySchema = yupUnion(
  transactionEntryMoneyTransferSchema,
  transactionEntryItemQuantityChangeSchema,
  transactionEntryProductGrantSchema,
  transactionEntryProductRevocationSchema,
  transactionEntryProductRevocationReversalSchema,
).defined();

export type TransactionEntry = InferType<typeof transactionEntrySchema>;

export const TRANSACTION_TYPES = [
  "purchase",
  "subscription-cancellation",
  "subscription-renewal",
  "chargeback",
  "manual-item-quantity-change",
  "upgrade",
  "downgrade",
  "product-change",
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
