import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const MAX_ACTIVITY_LIMIT = 200;

// Audit-log feed for all feature-flag resources of the tenancy (experiment
// runs today; flags/segments/holdouts once the other workstreams write to the
// same table). Not gated on the analytics app: audit history must stay
// readable even after a project disables analytics.
export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      resource_type: yupString().max(64).optional(),
      resource_id: yupString().max(256).optional(),
      limit: yupString().optional(),
      cursor: yupString().uuid().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(yupObject({
        id: yupString().defined(),
        resource_type: yupString().defined(),
        resource_id: yupString().defined(),
        action: yupString().defined(),
        actor_type: yupString().defined(),
        actor_id: yupString().nullable().defined(),
        source: yupString().defined(),
        before_state: yupMixed().nullable(),
        after_state: yupMixed().nullable(),
        metadata: yupMixed().nullable(),
        created_at_millis: yupNumber().defined(),
      }).defined()).defined(),
      next_cursor: yupString().nullable().defined(),
    }).defined(),
  }),
  async handler({ auth, query }) {
    const limit = Math.min(Math.max(parseInt(query.limit ?? "50", 10) || 50, 1), MAX_ACTIVITY_LIMIT);
    const entries = await globalPrismaClient.featureFlagAuditLog.findMany({
      where: {
        projectId: auth.tenancy.project.id,
        branchId: auth.tenancy.branchId,
        ...query.resource_type != null ? { resourceType: query.resource_type } : {},
        ...query.resource_id != null ? { resourceId: query.resource_id } : {},
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...query.cursor != null ? { cursor: { id: query.cursor }, skip: 1 } : {},
    });
    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items: page.map((entry) => ({
          id: entry.id,
          resource_type: entry.resourceType,
          resource_id: entry.resourceId,
          action: entry.action,
          actor_type: entry.actorType,
          actor_id: entry.actorId,
          source: entry.source,
          before_state: entry.beforeState,
          after_state: entry.afterState,
          metadata: entry.metadata,
          created_at_millis: entry.createdAt.getTime(),
        })),
        next_cursor: hasMore ? page[page.length - 1].id : null,
      },
    };
  },
});
