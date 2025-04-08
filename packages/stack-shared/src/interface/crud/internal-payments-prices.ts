import { createCrud } from "../../crud";
import { yupBoolean, yupNumber, yupObject, yupString } from "../../schema-fields";

export const internalPaymentsPricesCrud = createCrud({
  adminReadSchema: yupObject({
    id: yupString().defined(),
    product_id: yupString().defined(),
    name: yupString().defined(),
    amount: yupNumber().defined(),
    currency: yupString().defined(),
    interval: yupString().nullable().defined(),
    interval_count: yupNumber().nullable().defined(),
    stripe_price_id: yupString().nullable().defined(),
    active: yupBoolean().defined(),
    created_at_millis: yupString().defined(),
  }),
  adminCreateSchema: yupObject({
    product_id: yupString().defined(),
    name: yupString().defined(),
    amount: yupNumber().defined(),
    currency: yupString().defined(),
    interval: yupString().nullable(),
    interval_count: yupNumber().nullable(),
    active: yupBoolean().optional(),
  }),
  adminUpdateSchema: yupObject({
    name: yupString().optional(),
    amount: yupNumber().optional(),
    currency: yupString().optional(),
    interval: yupString().nullable().optional(),
    interval_count: yupNumber().nullable().optional(),
    active: yupBoolean().optional(),
  }),
  adminDeleteSchema: yupObject({}),
});

export type InternalPaymentsPricesCrud = typeof internalPaymentsPricesCrud;