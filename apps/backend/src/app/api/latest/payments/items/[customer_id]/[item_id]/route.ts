import { ensureItemCustomerTypeMatches, getItemQuantityForCustomer, tryCreateItemQuantityChange } from "@/lib/payments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, clientOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
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

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      customer_id: yupString().defined(),
      item_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      quantity: yupNumber().integer().defined(),
      expires_at: yupString().optional(),
      description: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
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
    const success = await tryCreateItemQuantityChange({
      prisma,
      tenancy,
      customerId: req.params.customer_id,
      itemId: req.params.item_id,
      quantity: req.body.quantity,
    });
    if (!success) {
      throw new KnownErrors.ItemQuantityInsufficientAmount(req.params.item_id, req.params.customer_id, req.body.quantity);
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { success: true },
    };
  },
});
