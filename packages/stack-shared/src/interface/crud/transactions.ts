import type { InferType } from "yup";
import { customerTypeSchema, offerPriceSchema, yupBoolean, yupNumber, yupObject, yupString } from "../../schema-fields";

export const adminTransaction = yupObject({
  id: yupString().defined(),
  type: yupString().oneOf(["subscription", "one_time", "item_quantity_change"]).defined(),
  created_at_millis: yupNumber().defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  quantity: yupNumber().defined(),
  test_mode: yupBoolean().defined(),
  offer_display_name: yupString().nullable().defined(),
  price: offerPriceSchema.omit(["serverOnly", "freeTrial"]).nullable().defined(),
  status: yupString().nullable().defined(),
  item_id: yupString().optional(),
  description: yupString().nullable().optional(),
  expires_at_millis: yupNumber().nullable().optional(),
}).defined();

export type AdminTransaction = InferType<typeof adminTransaction>;


