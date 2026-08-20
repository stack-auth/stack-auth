import { getGrowthChatConversationBody } from "@/lib/growth/chat";
import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { requireGrowthWorkspaceReleased } from "@/lib/growth/report-release";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/** One growth chat conversation with its full UIMessage transcript, for resuming a chat. */
export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    params: yupObject({
      conversationId: yupString().defined(),
    }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params }) => {
    requireGrowthAppEnabled(auth.tenancy);
    await requireGrowthWorkspaceReleased(auth.tenancy);
    return { statusCode: 200, bodyType: "json", body: await getGrowthChatConversationBody(auth.tenancy, params.conversationId) };
  },
});
