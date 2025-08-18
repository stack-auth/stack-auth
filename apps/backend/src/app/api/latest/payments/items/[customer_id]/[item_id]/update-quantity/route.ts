import { ensureItemCustomerTypeMatches, getItemQuantityForCustomer } from "@/lib/payments";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getOrUndefined } from "@stackframe/stack-shared/dist/utils/objects";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      customer_id: yupString().defined(),
      item_id: yupString().defined(),
    }).defined(),
    query: yupObject({
      allow_negative: yupString().oneOf(["true", "false"]).defined(),
    }).defined(),
    body: yupObject({
      delta: yupNumber().integer().defined(),
      expires_at: yupString().optional(),
      description: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const { tenancy } = req.auth;
    const paymentsConfig = tenancy.config.payments;
    const allowNegative = req.query.allow_negative === "true";
    const itemConfig = getOrUndefined(paymentsConfig.items, req.params.item_id);
    if (!itemConfig) {
      throw new KnownErrors.ItemNotFound(req.params.item_id);
    }

    await ensureItemCustomerTypeMatches(req.params.item_id, itemConfig.customerType, req.params.customer_id, tenancy);
    const prisma = await getPrismaClientForTenancy(tenancy);

    const changeId = await retryTransaction(prisma, async (tx) => {
      const totalQuantity = await getItemQuantityForCustomer({
        prisma: tx,
        tenancy,
        itemId: req.params.item_id,
        customerId: req.params.customer_id,
      });
      if (!allowNegative && (totalQuantity + req.body.delta < 0)) {
        throw new KnownErrors.ItemQuantityInsufficientAmount(req.params.item_id, req.params.customer_id, req.body.delta);
      }
      const change = await tx.itemQuantityChange.create({
        data: {
          tenancyId: tenancy.id,
          customerId: req.params.customer_id,
          itemId: req.params.item_id,
          quantity: req.body.delta,
          description: req.body.description,
          expiresAt: req.body.expires_at ? new Date(req.body.expires_at) : null,
        },
      });
      return change.id;
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { id: changeId },
    };
  },
});
