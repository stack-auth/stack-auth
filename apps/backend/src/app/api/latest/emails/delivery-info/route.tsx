import { calculateCapacityRate, getEmailDeliveryStatsForTenancy } from "@/lib/email-delivery-stats";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

const windows = [
  { key: "hour" as const },
  { key: "day" as const },
  { key: "week" as const },
  { key: "month" as const },
];

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get email delivery info",
    description: "Returns delivery statistics and capacity information for the current tenancy.",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      stats: yupObject({
        hour: yupObject({ sent: yupNumber().defined(), bounced: yupNumber().defined(), marked_as_spam: yupNumber().defined() }).defined(),
        day: yupObject({ sent: yupNumber().defined(), bounced: yupNumber().defined(), marked_as_spam: yupNumber().defined() }).defined(),
        week: yupObject({ sent: yupNumber().defined(), bounced: yupNumber().defined(), marked_as_spam: yupNumber().defined() }).defined(),
        month: yupObject({ sent: yupNumber().defined(), bounced: yupNumber().defined(), marked_as_spam: yupNumber().defined() }).defined(),
      }).defined(),
      capacity: yupObject({
        rate_per_second: yupNumber().defined(),
        penalty_factor: yupNumber().defined(),
      }).defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    const stats = await getEmailDeliveryStatsForTenancy(auth.tenancy.id);
    const capacity = calculateCapacityRate(stats);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        stats: windows.reduce((acc, { key }) => {
          const windowStats = stats[key];
          acc[key] = {
            sent: windowStats.sent,
            bounced: windowStats.bounced,
            marked_as_spam: windowStats.markedAsSpam,
          };
          return acc;
        }, {} as Record<typeof windows[number]["key"], { sent: number, bounced: number, marked_as_spam: number }>),
        capacity: {
          rate_per_second: capacity.ratePerSecond,
          penalty_factor: capacity.penaltyFactor,
        },
      },
    };
  },
});
