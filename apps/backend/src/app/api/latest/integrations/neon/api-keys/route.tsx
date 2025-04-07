import { createApiKeySet } from "@/lib/internal-api-keys";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { apiKeyCrudHandlers } from "./crud";


export const GET = apiKeyCrudHandlers.listHandler;

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      project: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      description: yupString().defined(),
      expires_at_millis: yupNumber().defined(),
      has_publishable_client_key: yupBoolean().defined(),
      has_secret_server_key: yupBoolean().defined(),
      has_super_secret_admin_key: yupBoolean().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
      description: yupString().defined(),
      expires_at_millis: yupNumber().defined(),
      manually_revoked_at_millis: yupNumber().optional(),
      created_at_millis: yupNumber().defined(),
      publishable_client_key: yupString().optional(),
      secret_server_key: yupString().optional(),
      super_secret_admin_key: yupString().optional(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const set = await createApiKeySet({
      projectId: auth.project.id,
      ...body,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: set,
    } as const;
  },
});
