import { createApiKeySet } from "@/lib/internal-api-keys";
import { createOrUpdateProject } from "@/lib/projects";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { neonAuthorizationHeaderSchema, projectDisplayNameSchema, yupArray, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { decodeBasicAuthorizationHeader } from "@stackframe/stack-shared/dist/utils/http";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    body: yupObject({
      display_name: projectDisplayNameSchema.defined(),
      connection_strings: yupArray(yupObject({
        branch_id: yupString().defined(),
        connection_string: yupString().defined(),
      }).defined()).optional(),
    }).defined(),
    headers: yupObject({
      authorization: yupTuple([neonAuthorizationHeaderSchema.defined()]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      project_id: yupString().defined(),
      super_secret_admin_key: yupString().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const [clientId] = decodeBasicAuthorizationHeader(req.headers.authorization[0])!;

    const createdProject = await createOrUpdateProject({
      ownerIds: [],
      sourceOfTruth: req.body.connection_strings ? {
        type: 'neon',
        connectionStrings: Object.fromEntries(req.body.connection_strings.map((c) => [c.branch_id, c.connection_string])),
      } : { type: 'hosted' },
      type: 'create',
      data: {
        display_name: req.body.display_name,
        description: "Created with Neon",
        config: {
          oauth_providers: [
            {
              id: "google",
              type: "shared",
            },
            {
              id: "github",
              type: "shared",
            },
          ],
          allow_localhost: true,
          credential_enabled: true
        },
      }
    });


    await globalPrismaClient.provisionedProject.create({
      data: {
        projectId: createdProject.id,
        clientId: clientId,
      },
    });

    const set = await createApiKeySet({
      projectId: createdProject.id,
      description: `Auto-generated for Neon Auth (DO NOT DELETE)`,
      expires_at_millis: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 100).getTime(),
      has_publishable_client_key: false,
      has_secret_server_key: false,
      has_super_secret_admin_key: true,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        project_id: createdProject.id,
        super_secret_admin_key: set.super_secret_admin_key!,
      },
    };
  },
});
