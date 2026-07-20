import { fetchBulldozerServerJson } from "@/lib/bulldozer-server-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { TRANSACTION_TYPES, transactionSchema, type Transaction } from "@hexclave/shared/dist/interface/crud/transactions";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

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
      customer_id: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      transactions: yupArray(transactionSchema).defined(),
      next_cursor: yupString().nullable().defined(),
    }).defined(),
  }),
  handler: async ({ auth, query }) => {
    const rawLimit = query.limit ?? "50";
    const parsedLimit = Number.parseInt(rawLimit, 10);
    const limit = Math.max(1, Math.min(200, Number.isFinite(parsedLimit) ? parsedLimit : 50));
    const searchParams = new URLSearchParams({
      limit: String(limit),
    });
    if (query.cursor != null) searchParams.set("cursor", query.cursor);
    if (query.type != null) searchParams.set("type", query.type);
    if (query.customer_type != null) searchParams.set("customer_type", query.customer_type);
    if (query.customer_id != null) searchParams.set("customer_id", query.customer_id);
    const { transactions, next_cursor } = await fetchBulldozerServerJson<{
      transactions: Transaction[],
      next_cursor: string | null,
    }>({
      method: "GET",
      path: `/v1/${encodeURIComponent(auth.tenancy.id)}/transactions?${searchParams.toString()}`,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        transactions,
        next_cursor,
      },
    };
  },
});
