import { generateGrowthBlogDraft } from "@/lib/growth/blog-drafts";
import { requireGrowthInternalResourceAccess } from "@/lib/growth/customer-access";
import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { requireGrowthWorkspaceReleased } from "@/lib/growth/report-release";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

// The generation runs inside this request (see lib/growth/blog-drafts.ts for why it is synchronous
// rather than a dispatched job), so the function needs a duration budget above the lib's own
// 4-minute Eve timeout — otherwise the platform would kill the request first and the customer would
// see an opaque failure for a generation that was still in flight.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Writes the blog post for a `publish_blog` action item, on demand.
 *
 * Admin auth, like every other dashboard-initiated growth mutation: this is a human pressing
 * "Generate draft" on an action item they are looking at. Nothing an agent session can hold reaches
 * this route.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    params: yupObject({
      action_id: yupString().uuid().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      draft_markdown: yupString().defined(),
      /** false when a draft already existed — the call is idempotent, and the UI says nothing new happened. */
      generated: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ auth, params }) => {
    requireGrowthInternalResourceAccess(auth.tenancy);
    requireGrowthAppEnabled(auth.tenancy);
    await requireGrowthWorkspaceReleased(auth.tenancy);
    const { draftMarkdown, generated } = await generateGrowthBlogDraft(auth.tenancy, params.action_id);
    return {
      statusCode: 200,
      bodyType: "json",
      body: { draft_markdown: draftMarkdown, generated },
    };
  },
});
