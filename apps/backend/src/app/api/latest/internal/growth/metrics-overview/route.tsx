import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { requireGrowthWorkspaceReleased } from "@/lib/growth/report-release";
import { getGrowthMetricsOverviewBody } from "@/lib/growth/metrics-overview";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const metricPointSchema = yupObject({
  date: yupString().defined(),
  value: yupNumber().defined(),
});

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      window_days: yupNumber().defined(),
      latest_stored_date: yupString().nullable().defined(),
      metrics: yupArray(yupObject({
        id: yupString().defined(),
        label: yupString().defined(),
        unit: yupString().oneOf(["count", "cents", "percent", "seconds", "minor_units"]).defined(),
        category: yupString().defined(),
        kind: yupString().oneOf(["flow", "snapshot"]).defined(),
        description: yupString().defined(),
        latest: metricPointSchema.nullable().defined(),
        series: yupArray(metricPointSchema.defined()).defined(),
      }).defined()).defined(),
      ad_accounts: yupArray(yupObject({
        account_id: yupString().defined(),
        account_timezone: yupString().defined(),
        currency: yupString().defined(),
        series: yupArray(yupObject({
          date: yupString().defined(),
          spend_minor: yupNumber().defined(),
          impressions: yupNumber().defined(),
          clicks: yupNumber().defined(),
        }).defined()).defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    requireGrowthAppEnabled(auth.tenancy);
    await requireGrowthWorkspaceReleased(auth.tenancy);
    return { statusCode: 200, bodyType: "json", body: await getGrowthMetricsOverviewBody(auth.tenancy, new Date()) };
  },
});
