import { getTransactionsPaginatedList } from "@/lib/payments/ledger/transactions";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { TRANSACTION_TYPES } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

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
      type: yupString().oneOf(TRANSACTION_TYPES).optional(),
      customer_type: yupString().oneOf(['user', 'team', 'custom']).optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({}).noUnknown(false).defined(),
  }),
  handler: async ({ auth, query }) => {
    const rawLimit = query.limit ?? "50";
    const parsedLimit = Number.parseInt(rawLimit, 10);
    const limit = Math.max(1, Math.min(200, Number.isFinite(parsedLimit) ? parsedLimit : 50));

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const list = getTransactionsPaginatedList(prisma, auth.tenancy.id);
    const cursor = query.cursor ?? list.getFirstCursor();

    const result = await list.next({
      after: cursor,
      limit,
      filter: {
        type: query.type,
        customerType: query.customer_type,
      },
      orderBy: "createdAt-desc",
      limitPrecision: "approximate",
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        transactions: result.items.map((entry) => entry.item),
        next_cursor: result.isLast ? null : result.cursor,
      },
    };
  },
});
