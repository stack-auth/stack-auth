import { listReplayIssueClustersForTenancy } from "@/lib/replay-ai";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      limit: yupString().optional(),
      severity: yupString().oneOf(["low", "medium", "high", "critical"]).optional(),
      search: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(yupMixed().defined()).defined(),
    }).defined(),
  }),
  async handler({ auth, query }) {
    const limit = query.limit ? Number(query.limit) : undefined;
    const items = await listReplayIssueClustersForTenancy({
      tenancy: auth.tenancy,
      limit: Number.isFinite(limit) ? limit : undefined,
      severity: parseSeverityQuery(query.severity),
      search: query.search,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { items },
    };
  },
});

function parseSeverityQuery(value: string | undefined): "low" | "medium" | "high" | "critical" | undefined {
  switch (value) {
    case "low": {
      return value;
    }
    case "medium": {
      return value;
    }
    case "high": {
      return value;
    }
    case "critical": {
      return value;
    }
    default: {
      return undefined;
    }
  }
}
