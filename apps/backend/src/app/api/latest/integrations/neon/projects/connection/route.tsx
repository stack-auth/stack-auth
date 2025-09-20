import { overrideProjectConfigOverride } from "@/lib/config";
import { getPrismaClientForSourceOfTruth, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { stackServerApp } from "@/stack";
import { KnownErrors } from "@stackframe/stack-shared";
import { neonAuthorizationHeaderSchema, yupArray, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { decodeBasicAuthorizationHeader } from "@stackframe/stack-shared/dist/utils/http";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    query: yupObject({
      project_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      connection_strings: yupArray(yupObject({
        branch_id: yupString().defined(),
        connection_string: yupString().defined(),
      }).defined()).defined(),
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
    }).defined(),
  }),
  handler: async (req) => {
    const [clientId] = decodeBasicAuthorizationHeader(req.headers.authorization[0])!;
    const provisionedProject = await globalPrismaClient.provisionedProject.findUnique({
      where: {
        projectId: req.query.project_id,
        clientId: clientId,
      },
    });
    if (!provisionedProject) {
      throw new KnownErrors.ProjectNotFound(req.query.project_id);
    }

    const uuidConnectionStrings: Record<string, string> = {};
    const store = await stackServerApp.getDataVaultStore('neon-connection-strings');
    const secret = "no client side encryption";
    for (const c of req.body.connection_strings) {
      const uuid = generateUuid();
      await store.setValue(uuid, c.connection_string, { secret });
      uuidConnectionStrings[c.branch_id] = uuid;
    }

    const sourceOfTruthPersisted = {
      type: 'neon' as const,
      connectionStrings: uuidConnectionStrings,
    };
    await overrideProjectConfigOverride({
      projectId: provisionedProject.projectId,
      projectConfigOverrideOverride: {
        sourceOfTruth: sourceOfTruthPersisted,
      },
    });

    await Promise.all(req.body.connection_strings.map(({ branch_id, connection_string }) => getPrismaClientForSourceOfTruth({
      type: 'neon',
      connectionString: undefined,
      connectionStrings: { [branch_id]: connection_string },
    } as const, branch_id)));

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        project_id: provisionedProject.projectId,
      },
    };
  },
});
