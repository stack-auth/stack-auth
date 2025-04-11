import { createCrud, CrudTypeOf } from "../../crud";
import { yupObject, yupString } from "../../schema-fields";

export const purchaseRequestSchema = yupObject({
  product_id: yupString().defined(),
}).defined();

export const purchaseResponseSchema = yupObject({
  purchase_url: yupString().defined(),
}).defined();

export const purchasesCrud = createCrud({
  clientReadSchema: purchaseResponseSchema,
  serverReadSchema: purchaseResponseSchema,
  clientCreateSchema: purchaseRequestSchema,
  serverCreateSchema: purchaseRequestSchema,
  docs: {
    clientCreate: {
      summary: 'Create purchase URL',
      description: 'Creates a purchase URL for the specified product.',
      tags: ['Purchases'],
    },
    serverCreate: {
      summary: 'Create purchase URL',
      description: 'Creates a purchase URL for the specified product.',
      tags: ['Purchases'],
    },
  },
});

export type PurchasesCrud = CrudTypeOf<typeof purchasesCrud>;