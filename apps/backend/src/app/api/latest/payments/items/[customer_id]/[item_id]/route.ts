import { ensureItemCustomerTypeMatches, getItemQuantityForCustomer } from "@/lib/payments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getOrUndefined } from "@stackframe/stack-shared/dist/utils/objects";


export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      customer_id: yupString().defined(),
      item_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
      display_name: yupString().defined(),
      quantity: yupNumber().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const { tenancy } = req.auth;
    const paymentsConfig = tenancy.config.payments;

    const itemConfig = getOrUndefined(paymentsConfig.items, req.params.item_id);
    if (!itemConfig) {
      throw new KnownErrors.ItemNotFound(req.params.item_id);
    }

    await ensureItemCustomerTypeMatches(req.params.item_id, itemConfig.customerType, req.params.customer_id, tenancy);
    const prisma = await getPrismaClientForTenancy(tenancy);
    const totalQuantity = await getItemQuantityForCustomer({
      prisma,
      tenancy,
      itemId: req.params.item_id,
      customerId: req.params.customer_id,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        id: req.params.item_id,
        display_name: itemConfig.displayName,
        quantity: totalQuantity,
      },
    };
  },
});
