import { createApiKeySet } from "@/lib/internal-api-keys";
import { createOrUpdateProjectWithLegacyConfig } from "@/lib/projects";
import { getPrismaClientForSourceOfTruth, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { OrganizationRenderedConfig } from "@stackframe/stack-shared/dist/config/schema";
import { neonAuthorizationHeaderSchema, projectDisplayNameSchema, yupArray, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { decodeBasicAuthorizationHeader } from "@stackframe/stack-shared/dist/utils/http";

const buildSourceOfTruth = (connectionStrings: { branch_id: string, connection_string: string }[]): OrganizationRenderedConfig["sourceOfTruth"] => {
  return connectionStrings.length > 0 ? {
    type: 'neon' as const,
    connectionString: undefined,
    connectionStrings: Object.fromEntries(connectionStrings.map((c) => [c.branch_id, c.connection_string])),
  } : {
    type: 'hosted' as const,
    connectionStrings: undefined,
    connectionString: undefined,
  };
};

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

    const sourceOfTruth = buildSourceOfTruth(req.body.connection_strings ?? []);
    const createdProject = await createOrUpdateProjectWithLegacyConfig({
      ownerIds: [],
      sourceOfTruth: sourceOfTruth,
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

    if (sourceOfTruth.type === 'neon') {
      // Run migration for all branches in parallel. The `getPrismaClientForSourceOfTruth` internally runs migrations before returning the client
      // De-duplicate branch IDs to avoid duplicate runs
      const branchIds = Object.keys(sourceOfTruth.connectionStrings);
      await Promise.all(branchIds.map((branchId) => getPrismaClientForSourceOfTruth(sourceOfTruth, branchId)));
    }

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
