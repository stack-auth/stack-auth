import { DeploymentServiceDefinition, ENV_VAR_KEY_REGEX, assertServiceDefinitionsEditable, deleteServiceDefinitionFromConfig, getServiceDefinitionOrThrow, getOrCreateOperationalService, resolveEnvVars, serviceToApiShape, updateServiceDefinitionInConfig } from "@/lib/deployments";
import { getVercelDeploymentsClientOrThrow, getVercelDeploymentsConfigOrNull, sanitizeVercelError } from "@/lib/deployments/vercel-client";
import { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupArray, yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const paramsSchema = yupObject({
  service_id: userSpecifiedIdSchema("serviceId").defined(),
}).defined();

const authSchema = yupObject({
  type: serverOrHigherAuthTypeSchema,
  tenancy: adaptSchema.defined(),
}).defined();

async function loadServiceForResponse(tenancy: Tenancy, serviceId: string, definition: DeploymentServiceDefinition) {
  const prisma = await getPrismaClientForTenancy(tenancy);
  const operational = await prisma.deploymentService.findUnique({
    where: {
      tenancyId_serviceId: {
        tenancyId: tenancy.id,
        serviceId,
      },
    },
    include: { envVars: true, domains: true },
  });
  return await serviceToApiShape({
    prisma,
    tenancy,
    serviceId,
    definition,
    operational,
  });
}

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get deployment service",
    description: "Returns a deployment service definition merged with its operational state.",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: authSchema,
    params: paramsSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params }) => {
    const definition = getServiceDefinitionOrThrow(auth.tenancy, params.service_id);
    return {
      statusCode: 200,
      bodyType: "json",
      body: await loadServiceForResponse(auth.tenancy, params.service_id, definition),
    };
  },
});

export const PATCH = createSmartRouteHandler({
  metadata: {
    summary: "Update deployment service",
    description: "Updates a deployment service. Build configuration fields edit the definition in the project configuration (only when the config is managed by the dashboard); env_vars replace the dashboard-managed env var set and are pushed to the deployment target if it has been provisioned.",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: authSchema,
    params: paramsSchema,
    body: yupObject({
      framework: yupString().nullable().optional(),
      install_command: yupString().nullable().optional(),
      build_command: yupString().nullable().optional(),
      output_directory: yupString().nullable().optional(),
      root_directory: yupString().nullable().optional(),
      env_vars: yupArray(yupObject({
        key: yupString().defined().matches(ENV_VAR_KEY_REGEX, "Invalid env var key"),
        value: yupString().defined(),
        is_secret: yupBoolean().optional(),
      }).defined()).optional(),
    }).defined(),
    method: yupString().oneOf(["PATCH"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params, body }) => {
    let definition = getServiceDefinitionOrThrow(auth.tenancy, params.service_id);
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const definitionPatch = {
      framework: body.framework,
      installCommand: body.install_command,
      buildCommand: body.build_command,
      outputDirectory: body.output_directory,
      rootDirectory: body.root_directory,
    };
    const hasDefinitionChanges = Object.values(definitionPatch).some((value) => value !== undefined);
    if (hasDefinitionChanges) {
      await assertServiceDefinitionsEditable(auth.tenancy);
      await updateServiceDefinitionInConfig(auth.tenancy, params.service_id, definitionPatch);
      // The tenancy's rendered config snapshot predates our write; overlay the
      // patch so the response reflects what we just persisted.
      definition = {
        ...definition,
        ...Object.fromEntries(Object.entries({
          framework: definitionPatch.framework,
          installCommand: definitionPatch.installCommand,
          buildCommand: definitionPatch.buildCommand,
          outputDirectory: definitionPatch.outputDirectory,
          rootDirectory: definitionPatch.rootDirectory,
        }).filter(([, value]) => value !== undefined).map(([key, value]) => [key, value ?? undefined])),
      };
    }

    if (body.env_vars !== undefined) {
      const duplicateKey = body.env_vars.map((e) => e.key).find((key, i, keys) => keys.indexOf(key) !== i);
      if (duplicateKey != null) {
        throw new StatusError(400, `Duplicate env var key: ${JSON.stringify(duplicateKey)}`);
      }
      const service = await getOrCreateOperationalService(prisma, auth.tenancy, params.service_id);
      const existingVars = await prisma.deploymentServiceEnvVar.findMany({
        where: { tenancyId: auth.tenancy.id, deploymentServiceId: service.id },
      });
      const newKeys = new Set(body.env_vars.map((envVar) => envVar.key));
      const removedKeys = existingVars.filter((envVar) => !newKeys.has(envVar.key)).map((envVar) => envVar.key);

      // Full replace of the dashboard-managed set, atomically — a failure
      // between delete and create must not wipe the stored env vars.
      const newEnvVars = body.env_vars;
      await retryTransaction(prisma, async (tx) => {
        await tx.deploymentServiceEnvVar.deleteMany({
          where: { tenancyId: auth.tenancy.id, deploymentServiceId: service.id },
        });
        if (newEnvVars.length > 0) {
          await tx.deploymentServiceEnvVar.createMany({
            data: newEnvVars.map((envVar) => ({
              tenancyId: auth.tenancy.id,
              deploymentServiceId: service.id,
              key: envVar.key,
              value: envVar.value,
              isSecret: envVar.is_secret ?? false,
            })),
          });
        }
      });

      // Write-through to Vercel once the project exists; before provisioning
      // there's nothing to push (the first deploy pushes the current set).
      if (service.vercelProjectId != null) {
        const client = getVercelDeploymentsClientOrThrow();
        const { resolved } = await resolveEnvVars({ tenancy: auth.tenancy, prisma, envVars: body.env_vars });
        try {
          await client.upsertEnvVars(service.vercelProjectId, resolved);
          if (removedKeys.length > 0) {
            const vercelVars = await client.listEnvVarKeys(service.vercelProjectId);
            for (const vercelVar of vercelVars) {
              if (removedKeys.includes(vercelVar.key)) {
                await client.deleteEnvVar(service.vercelProjectId, vercelVar.id);
              }
            }
          }
        } catch (e) {
          sanitizeVercelError(e, "Pushing env vars to the deployment failed");
        }
      }
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: await loadServiceForResponse(auth.tenancy, params.service_id, definition),
    };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: {
    summary: "Delete deployment service",
    description: "Deletes a deployment service: removes the definition from the project configuration, deletes the Vercel project if one was provisioned, and drops all operational state. Only available when the config is managed by the dashboard.",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: authSchema,
    params: paramsSchema,
    method: yupString().oneOf(["DELETE"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
    }).defined(),
  }),
  handler: async ({ auth, params }) => {
    getServiceDefinitionOrThrow(auth.tenancy, params.service_id);
    await assertServiceDefinitionsEditable(auth.tenancy);
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const operational = await prisma.deploymentService.findUnique({
      where: {
        tenancyId_serviceId: {
          tenancyId: auth.tenancy.id,
          serviceId: params.service_id,
        },
      },
    });
    if (operational?.vercelProjectId != null) {
      if (getVercelDeploymentsConfigOrNull() == null) {
        throw new StatusError(400, "This service has a provisioned deployment target, but Vercel deployments are not configured on this Hexclave instance, so it can't be cleaned up. Configure HEXCLAVE_VERCEL_BEARER_TOKEN and HEXCLAVE_VERCEL_TEAM_ID first.");
      }
      try {
        await getVercelDeploymentsClientOrThrow().deleteProject(operational.vercelProjectId);
      } catch (e) {
        sanitizeVercelError(e, "Deleting the deployment target failed");
      }
    }
    await deleteServiceDefinitionFromConfig(auth.tenancy, params.service_id);
    if (operational != null) {
      await prisma.deploymentService.delete({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: operational.id } },
      });
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: { success: true },
    };
  },
});
