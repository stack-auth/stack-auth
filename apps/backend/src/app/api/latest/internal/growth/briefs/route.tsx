import { listGrowthBriefsBody } from "@/lib/growth/briefs";
import { requireGrowthInternalResourceAccess } from "@/lib/growth/customer-access";
import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { requireGrowthWorkspaceReleased } from "@/lib/growth/report-release";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

// Query params arrive as strings; parsed by hand (same as the actions list route) so a garbage
// value is a clean 400 instead of a yup coercion surprise.
function parseLimit(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new StatusError(400, "limit must be a positive integer");
  }
  return value;
}

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["GET"]).defined(),
    query: yupObject({
      cursor: yupString().optional(),
      // Not sent by the dashboard fetcher (it always takes the default page size); exists so tests
      // and power users can exercise pagination with small pages.
      limit: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, query }) => {
    requireGrowthInternalResourceAccess(auth.tenancy);
    requireGrowthAppEnabled(auth.tenancy);
    await requireGrowthWorkspaceReleased(auth.tenancy);
    const body = await listGrowthBriefsBody(auth.tenancy, {
      cursor: query.cursor,
      limit: parseLimit(query.limit),
    });
    return { statusCode: 200, bodyType: "json", body };
  },
});
