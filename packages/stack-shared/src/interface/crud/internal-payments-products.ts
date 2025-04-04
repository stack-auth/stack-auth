import { createCrud } from "../../crud";
import { yupObject, yupString } from "../../schema-fields";

export const internalPaymentsProductsCrud = createCrud({
  clientReadSchema: yupObject({
    id: yupString().defined(),
    name: yupString().defined(),
    stripe_product_id: yupString().nullable().defined(),
    associated_permission_id: yupString().uuid().nullable().defined(),
    created_at_millis: yupString().defined(),
    project_id: yupString().defined(),
  }),
  clientReadDocs: {
    hidden: false,
    summary: "Read internal product details",
    description: "A product used in the payment system (internal API)",
    tags: ["products", "internal"],
  },
  serverReadSchema: yupObject({
    id: yupString().defined(),
    name: yupString().defined(),
    stripe_product_id: yupString().nullable().defined(),
    associated_permission_id: yupString().uuid().nullable().defined(),
    created_at_millis: yupString().defined(),
    project_id: yupString().defined(),
  }),
  serverCreateSchema: yupObject({
    name: yupString().defined(),
    stripe_product_id: yupString().nullable(),
    associated_permission_id: yupString().uuid().nullable(),
    project_id: yupString().defined(),
  }),
  serverUpdateSchema: yupObject({
    name: yupString().optional(),
    stripe_product_id: yupString().nullable().optional(),
    associated_permission_id: yupString().uuid().nullable().optional(),
  }),
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
    project_id: yupString().defined(),
  }),
  adminUpdateSchema: yupObject({
    name: yupString().optional(),
    stripe_product_id: yupString().nullable().optional(),
    associated_permission_id: yupString().uuid().nullable().optional(),
  }),
});

export type InternalPaymentsProductsCrud = typeof internalPaymentsProductsCrud;
