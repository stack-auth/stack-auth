import { enrollSpacetimeBrowserIdentity, makeCachedSpacetimeBrowserSession, mintSpacetimeBrowserSession } from "@/lib/ai/spacetimedb-browser-session";
import { assertIsAiChatReviewer } from "@/lib/ai/qa/reviewer-auth";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const JSON_BODY_TYPE = "json";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema.defined(),
      project: adaptSchema,
    }).defined(),
    body: yupObject({
      cachedIdentity: yupString().optional(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      host: yupString().defined(),
      dbName: yupString().defined(),
      identity: yupString().defined(),
      token: yupString().optional(),
      scopeKey: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    assertIsAiChatReviewer(auth);
    const user = auth.user;
    const displayName = user.display_name ?? user.primary_email ?? user.id;

    if (body.cachedIdentity != null) {
      await enrollSpacetimeBrowserIdentity(body.cachedIdentity, user.id, displayName);
      return {
        statusCode: 200,
        bodyType: JSON_BODY_TYPE,
        body: makeCachedSpacetimeBrowserSession(body.cachedIdentity, user.id),
      };
    }

    const session = await mintSpacetimeBrowserSession(user.id);
    await enrollSpacetimeBrowserIdentity(session.identity, user.id, displayName);

    return {
      statusCode: 200,
      bodyType: JSON_BODY_TYPE,
      body: session,
    };
  },
});
