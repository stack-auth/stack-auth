import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { requireGrowthWorkspaceReleased } from "@/lib/growth/report-release";
import { getGrowthOverviewBody } from "@/lib/growth/overview";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

function parseLimit(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new StatusError(400, "limit must be a positive integer");
  return value;
}

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({ type: adminAuthTypeSchema.defined(), tenancy: adaptSchema.defined() }),
    method: yupString().oneOf(["GET"]).defined(),
    query: yupObject({ limit: yupString().optional() }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, query }) => {
    requireGrowthAppEnabled(auth.tenancy);
    await requireGrowthWorkspaceReleased(auth.tenancy);
    return { statusCode: 200, bodyType: "json", body: await getGrowthOverviewBody(auth.tenancy, parseLimit(query.limit)) };
  },
});
