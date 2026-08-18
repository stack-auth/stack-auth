import { OTLP_METRIC_TYPES, queryOtlpMetrics } from "@/lib/otlp/metric-query";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import {
  adaptSchema,
  adminAuthTypeSchema,
  jsonSchema,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Query native OpenTelemetry metrics",
    description: "Returns a bounded, project-scoped native OpenTelemetry Metrics read model for the observability dashboard.",
    tags: ["Analytics"],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      hours: yupNumber().integer().oneOf([1, 24, 168, 720]).default(24),
      metric_name: yupString().nonEmpty().max(255).optional(),
      // One OTLP metric NAME can exist with several metric types, each being
      // its own catalog entry/series — without the type the query could
      // resolve a different entry than the one the selector shows.
      metric_type: yupString().oneOf([...OTLP_METRIC_TYPES]).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: jsonSchema.defined(),
  }),
  async handler({ auth, body }) {
    if (auth.tenancy.config.apps.installed["observability"]?.enabled !== true) {
      throw new KnownErrors.ObservabilityNotEnabled();
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: await queryOtlpMetrics({
        tenancy: auth.tenancy,
        request: {
          hours: body.hours,
          metricName: body.metric_name,
          metricType: body.metric_type,
        },
      }),
    };
  },
});
