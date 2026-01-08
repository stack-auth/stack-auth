import { listTransactions, NEW_TRANSACTION_TYPES } from "@/lib/new-transactions";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  adminAuthTypeSchema,
  adaptSchema,
  customerTypeSchema,
  yupArray,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
} from "@stackframe/stack-shared/dist/schema-fields";
import { transactionEntrySchema } from "@stackframe/stack-shared/dist/interface/crud/transactions";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      cursor: yupString().optional(),
      limit: yupString().optional(),
      type: yupString().oneOf([...NEW_TRANSACTION_TYPES]).optional(),
      customer_type: customerTypeSchema.optional(),
      customer_id: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      transactions: yupArray(
        yupObject({
          id: yupString().defined(),
          type: yupString().oneOf([...NEW_TRANSACTION_TYPES]).defined(),
          created_at_millis: yupNumber().defined(),
          effective_at_millis: yupNumber().defined(),
          entries: yupArray(transactionEntrySchema).defined(),
          adjusted_by: yupArray(
            yupObject({
              transaction_id: yupString().defined(),
              entry_index: yupNumber().integer().min(0).defined(),
            }).defined(),
          ).defined(),
          test_mode: yupBoolean().defined(),
        }).defined(),
      ).defined(),
      next_cursor: yupString().nullable().defined(),
      has_more: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ auth, query }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const rawLimit = query.limit ?? "50";
    const parsedLimit = Number.parseInt(rawLimit, 10);
    const limit = Math.max(1, Math.min(200, Number.isFinite(parsedLimit) ? parsedLimit : 50));

    const result = await listTransactions({
      prisma,
      tenancy: auth.tenancy,
      filter: {
        customerType: query.customer_type,
        customerId: query.customer_id,
        transactionType: query.type,
      },
      cursor: query.cursor,
      limit,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        transactions: result.transactions,
        next_cursor: result.nextCursor,
        has_more: result.hasMore,
      },
    };
  },
});
