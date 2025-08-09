import { ensureItemCustomerTypeMatches } from "@/lib/payments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { SubscriptionStatus } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, clientOrHigherAuthTypeSchema, offerSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getOrUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import * as yup from "yup";

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
    const subscriptions = await prisma.subscription.findMany({
      where: {
        tenancyId: tenancy.id,
        customerId: req.params.customer_id,
        status: {
          in: [SubscriptionStatus.active, SubscriptionStatus.trialing],
        }
      },
    });

    const subscriptionQuantity = subscriptions.reduce((acc, subscription) => {
      const offer = subscription.offer as yup.InferType<typeof offerSchema>;
      const item = getOrUndefined(offer.includedItems, req.params.item_id);
      return acc + (item?.quantity ?? 0);
    }, 0);
    const manualChanges = await prisma.itemQuantityChange.findMany({
      where: {
        tenancyId: tenancy.id,
        customerId: req.params.customer_id,
        itemId: req.params.item_id,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });
    const manualQuantity = manualChanges.reduce((acc, change) => acc + change.quantity, 0);
    const totalQuantity = subscriptionQuantity + manualQuantity;

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
      quantity: yupNumber().defined(),
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

    const itemConfig = getOrUndefined(paymentsConfig.items, req.params.item_id);
    if (!itemConfig) {
      throw new KnownErrors.ItemNotFound(req.params.item_id);
    }

    await ensureItemCustomerTypeMatches(req.params.item_id, itemConfig.customerType, req.params.customer_id, tenancy);
    const prisma = await getPrismaClientForTenancy(tenancy);

    const change = await prisma.itemQuantityChange.create({
      data: {
        tenancyId: tenancy.id,
        customerId: req.params.customer_id,
        itemId: req.params.item_id,
        quantity: req.body.quantity,
        description: req.body.description,
        expiresAt: req.body.expires_at ? new Date(req.body.expires_at) : null,
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { id: change.id },
    } as const;
  },
});
