import { listGrowthChatConversationsBody } from "@/lib/growth/chat";
import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { requireGrowthWorkspaceReleased } from "@/lib/growth/report-release";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Lists the project's growth chat conversations (newest first). This exists because the companion
 * widget's internal/ai-conversations routes cannot serve the growth chat page: they are
 * internal-project USER-scoped, while growth conversations are project-scoped rows with no owning
 * user (see the storage decision in lib/growth/chat.ts).
 */
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
    body: yupMixed().defined(),
  }),
  handler: async ({ auth }) => {
    requireGrowthAppEnabled(auth.tenancy);
    await requireGrowthWorkspaceReleased(auth.tenancy);
    return { statusCode: 200, bodyType: "json", body: await listGrowthChatConversationsBody(auth.tenancy) };
  },
});
