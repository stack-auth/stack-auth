import { PlatformFeeStatus } from "@/lib/payments/platform-fees";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

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
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      // Sum of every platform fee event not yet marked COLLECTED, in
      // USD stripe-units (cents). Expands to a keyed map when multi-currency
      // support is introduced.
      total_due_usd: yupNumber().defined(),
      events: yupArray(
        yupObject({
          id: yupString().defined(),
          source_type: yupString().defined(),
          source_id: yupString().defined(),
          amount: yupNumber().defined(),
          currency: yupString().defined(),
          status: yupString().defined(),
          stripe_transfer_id: yupString().nullable().defined(),
          error: yupString().nullable().defined(),
          created_at: yupString().defined(),
          collected_at: yupString().nullable().defined(),
        }).defined(),
      ).defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    // TODO: pagination. Low-priority today (volume per tenancy is small), but
    // merchants with high refund throughput will eventually accumulate
    // thousands of rows here. Add cursor-based pagination before shipping a
    // merchant-visible UI.
    const events = await globalPrismaClient.platformFeeEvent.findMany({
      where: { tenancyId: auth.tenancy.id },
      orderBy: { createdAt: "desc" },
    });

    const totalDueUsdUnits = events
      .filter((e) => e.status !== PlatformFeeStatus.COLLECTED && e.currency === "usd")
      .reduce((sum, e) => sum + e.amount, 0);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        total_due_usd: totalDueUsdUnits,
        events: events.map((e) => ({
          id: e.id,
          source_type: e.sourceType,
          source_id: e.sourceId,
          amount: e.amount,
          currency: e.currency,
          status: e.status,
          stripe_transfer_id: e.stripeTransferId,
          error: e.error,
          created_at: e.createdAt.toISOString(),
          collected_at: e.collectedAt?.toISOString() ?? null,
        })),
      },
    };
  },
});
