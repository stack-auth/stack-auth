import { createCrud } from "../../crud";
import { yupObject, yupString } from "../../schema-fields";

export const internalPaymentsProductsCrud = createCrud({
  adminReadSchema: yupObject({
    id: yupString().defined(),
    name: yupString().defined(),
    stripe_product_id: yupString().nullable().defined(),
    associated_permission_id: yupString().uuid().nullable().defined(),
    created_at_millis: yupString().defined(),
    project_id: yupString().defined(),
  }),
  adminCreateSchema: yupObject({
    name: yupString().defined(),
    stripe_product_id: yupString().nullable(),
    associated_permission_id: yupString().uuid().nullable(),
  }),
  adminUpdateSchema: yupObject({
    name: yupString().optional(),
    stripe_product_id: yupString().nullable().optional(),
    associated_permission_id: yupString().uuid().nullable().optional(),
  }),
  adminDeleteSchema: yupObject({}),
});

export type InternalPaymentsProductsCrud = typeof internalPaymentsProductsCrud;
