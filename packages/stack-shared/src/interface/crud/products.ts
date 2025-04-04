import { createCrud } from "../../crud";
import { yupObject, yupString } from "../../schema-fields";

export const productsCrud = createCrud({
  clientReadSchema: yupObject({
    id: yupString().defined(),
    name: yupString().defined(),
    stripe_product_id: yupString().nullable().defined(),
    associated_permission_id: yupString().uuid().nullable().defined(),
    created_at_millis: yupString().defined(),
  }),
  clientReadDocs: {
    hidden: false,
    summary: "Read product details",
    description: "A product used in the payment system",
    tags: ["products"],
  },
  serverReadSchema: yupObject({
    id: yupString().defined(),
    name: yupString().defined(),
    stripe_product_id: yupString().nullable().defined(),
    associated_permission_id: yupString().uuid().nullable().defined(),
    created_at_millis: yupString().defined(),
  }),
  serverCreateSchema: yupObject({
    name: yupString().defined(),
    stripe_product_id: yupString().nullable(),
    associated_permission_id: yupString().uuid().nullable(),
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
});

export type ProductsCrud = typeof productsCrud;
