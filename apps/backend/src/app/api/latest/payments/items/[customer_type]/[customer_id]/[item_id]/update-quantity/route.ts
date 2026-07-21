import { ensureCustomerExists } from "@/lib/payments";
import { bulldozerWriteItemQuantityChange } from "@/lib/payments/bulldozer-dual-write";
import { getItemQuantityForCustomer } from "@/lib/payments/customer-data";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { getOrUndefined } from "@hexclave/shared/dist/utils/objects";
import { typedToUppercase } from "@hexclave/shared/dist/utils/strings";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { createHash } from "node:crypto";

function idempotentQuantityChangeId(options: {
  tenancyId: string,
  customerType: "user" | "team" | "custom",
  customerId: string,
  itemId: string,
  idempotencyKey: string,
}): string {
  const hex = createHash("sha256").update([
    "hexclave:item-quantity-change",
    options.tenancyId,
    options.customerType,
    options.customerId,
    options.itemId,
    options.idempotencyKey,
  ].join("\0"), "utf8").digest("hex");
  const variantNibble = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variantNibble}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function quantityChangeLockId(options: {
  tenancyId: string,
  customerType: "user" | "team" | "custom",
  customerId: string,
  itemId: string,
}): bigint {
  const hex = createHash("sha256").update([
    "hexclave:item-quantity-lock",
    options.tenancyId,
    options.customerType,
    options.customerId,
    options.itemId,
  ].join("\0"), "utf8").digest("hex").slice(0, 16);
  return BigInt.asIntN(64, BigInt(`0x${hex}`));
}

function ensureIdempotentQuantityChangeMatches(change: {
  customerId: string,
  customerType: string,
  itemId: string,
  quantity: number,
  description: string | null,
  expiresAt: Date | null,
}, expected: {
  customerId: string,
  customerType: "user" | "team" | "custom",
  itemId: string,
  quantity: number,
  description: string | null,
  expiresAt: Date | null,
}): void {
  if (
    change.customerId !== expected.customerId ||
    change.customerType !== typedToUppercase(expected.customerType) ||
    change.itemId !== expected.itemId ||
    change.quantity !== expected.quantity ||
    change.description !== expected.description ||
    change.expiresAt?.getTime() !== expected.expiresAt?.getTime()
  ) {
    throw new StatusError(StatusError.Conflict, "The item quantity idempotency key was already used for a different update");
  }
}

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: false,
    summary: "Update Item Quantity",
    description: "Updates the quantity of an item for a customer. Can increase or decrease quantities, with optional expiration and negative balance control.",
    tags: ["Payments"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      customer_type: yupString().oneOf(["user", "team", "custom"]).defined().meta({
        openapiField: {
          description: "The type of customer",
          exampleValue: "user"
        }
      }),
      customer_id: yupString().defined().meta({
        openapiField: {
          description: "The ID of the customer",
          exampleValue: "user_1234567890abcdef"
        }
      }),
      item_id: yupString().defined().meta({
        openapiField: {
          description: "The ID of the item to update",
          exampleValue: "credits"
        }
      }),
    }).defined(),
    query: yupObject({
      allow_negative: yupString().oneOf(["true", "false"]).defined().meta({
        openapiField: {
          description: "Whether to allow the quantity to go negative",
          exampleValue: "false"
        }
      }),
    }).defined(),
    body: yupObject({
      delta: yupNumber().integer().defined().meta({
        openapiField: {
          description: "The amount to change the quantity by (positive to increase, negative to decrease)",
          exampleValue: 100
        }
      }),
      expires_at: yupString().optional().meta({
        openapiField: {
          description: "Optional expiration date for this quantity change (ISO 8601 format)",
          exampleValue: "2024-12-31T23:59:59Z"
        }
      }),
      description: yupString().optional().meta({
        openapiField: {
          description: "Optional description for this quantity change",
          exampleValue: "Monthly subscription renewal"
        }
      }),
      idempotency_key: yupString().min(1).max(256).optional().meta({
        openapiField: {
          description: "Optional retry key. Reusing it with the same update applies the quantity change exactly once.",
          exampleValue: "analytics-batch:550e8400-e29b-41d4-a716-446655440000",
        },
      }),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({}).defined(),
  }),
  handler: async (req) => {
    const { tenancy } = req.auth;
    const paymentsConfig = tenancy.config.payments;
    const allowNegative = req.query.allow_negative === "true";
    const itemConfig = getOrUndefined(paymentsConfig.items, req.params.item_id);
    if (!itemConfig) {
      throw new KnownErrors.ItemNotFound(req.params.item_id);
    }

    if (req.params.customer_type !== itemConfig.customerType) {
      throw new KnownErrors.ItemCustomerTypeDoesNotMatch(req.params.item_id, req.params.customer_id, itemConfig.customerType, req.params.customer_type);
    }
    const prisma = await getPrismaClientForTenancy(tenancy);
    await ensureCustomerExists({
      prisma,
      tenancyId: tenancy.id,
      customerType: req.params.customer_type,
      customerId: req.params.customer_id,
    });

    const idempotentChangeId = req.body.idempotency_key === undefined ? undefined : idempotentQuantityChangeId({
      tenancyId: tenancy.id,
      customerType: req.params.customer_type,
      customerId: req.params.customer_id,
      itemId: req.params.item_id,
      idempotencyKey: req.body.idempotency_key,
    });
    const expiresAt = req.body.expires_at === undefined ? null : new Date(req.body.expires_at);
    const expectedChange = {
      customerId: req.params.customer_id,
      customerType: req.params.customer_type,
      itemId: req.params.item_id,
      quantity: req.body.delta,
      description: req.body.description ?? null,
      expiresAt,
    };
    if (idempotentChangeId !== undefined) {
      const existing = await prisma.itemQuantityChange.findUnique({
        where: { tenancyId_id: { tenancyId: tenancy.id, id: idempotentChangeId } },
      });
      if (existing !== null) {
        ensureIdempotentQuantityChangeMatches(existing, expectedChange);
        await bulldozerWriteItemQuantityChange(existing);
        return { statusCode: 200, bodyType: "json", body: {} };
      }
    }

    const changeData = {
      tenancyId: tenancy.id,
      customerId: req.params.customer_id,
      customerType: typedToUppercase(req.params.customer_type),
      itemId: req.params.item_id,
      quantity: req.body.delta,
      description: expectedChange.description,
      expiresAt,
    };
    const lockId = quantityChangeLockId({
      tenancyId: tenancy.id,
      customerType: req.params.customer_type,
      customerId: req.params.customer_id,
      itemId: req.params.item_id,
    });
    // This transaction intentionally is not wrapped in retryTransaction. The
    // critical section contains an idempotent external materializer write;
    // automatically replaying the callback after a synthetic rollback could
    // observe its own already-applied delta and incorrectly report insufficient
    // quantity. Callers retry the whole request with the same idempotency key.
    // eslint-disable-next-line no-restricted-syntax
    const change = await prisma.$transaction(async (tx) => {
      // The balance is materialized by bulldozer rather than Prisma, so the
      // advisory lock is the shared serialization point for every writer of a
      // customer/item pair. This deliberately holds one transaction over the
      // local balance read: without it, distinct idempotency keys can both see
      // the same credits and overdraw. The lock is narrow and the read does no
      // Prisma work, keeping the critical section bounded to one local call.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockId})`;
      if (idempotentChangeId !== undefined) {
        const existing = await tx.itemQuantityChange.findUnique({
          where: { tenancyId_id: { tenancyId: tenancy.id, id: idempotentChangeId } },
        });
        if (existing !== null) {
          ensureIdempotentQuantityChangeMatches(existing, expectedChange);
          await bulldozerWriteItemQuantityChange(existing);
          return existing;
        }
      }
      const totalQuantity = await getItemQuantityForCustomer({
        prisma: tx,
        tenancyId: tenancy.id,
        itemId: req.params.item_id,
        customerId: req.params.customer_id,
        customerType: req.params.customer_type,
      });
      if (!allowNegative && totalQuantity + req.body.delta < 0) {
        throw new KnownErrors.ItemQuantityInsufficientAmount(req.params.item_id, req.params.customer_id, req.body.delta);
      }
      if (idempotentChangeId === undefined) {
        const created = await tx.itemQuantityChange.create({ data: changeData });
        await bulldozerWriteItemQuantityChange(created);
        return created;
      }
      await tx.itemQuantityChange.createMany({
        data: [{ ...changeData, id: idempotentChangeId }],
        skipDuplicates: true,
      });
      const idempotentChange = await tx.itemQuantityChange.findUnique({
        where: { tenancyId_id: { tenancyId: tenancy.id, id: idempotentChangeId } },
      });
      if (idempotentChange === null) throw new StatusError(StatusError.Conflict, "The idempotent item quantity update could not be reserved");
      ensureIdempotentQuantityChangeMatches(idempotentChange, expectedChange);
      await bulldozerWriteItemQuantityChange(idempotentChange);
      return idempotentChange;
    }, { timeout: 15_000 });
    ensureIdempotentQuantityChangeMatches(change, expectedChange);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {},
    };
  },
});
