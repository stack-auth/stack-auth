import { DeploymentServiceDefinition, assertServiceDefinitionsEditable, deleteServiceDefinitionFromConfig, envRecordFromRequestBody, getServiceDefinitionOrThrow, resolveEnvVars, serviceToApiShape, updateServiceDefinitionInConfig } from "@/lib/deployments";
import { getVercelDeploymentsClientOrThrow, getVercelDeploymentsConfigOrNull, sanitizeVercelError } from "@/lib/deployments/vercel-client";
import { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { DEPLOYMENT_ENV_VAR_KEY_REGEX, deploymentEnvVarSchema } from "@hexclave/shared/dist/config/schema";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupBoolean, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "@hexclave/shared/dist/schema-fields";
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
    include: { domains: true },
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
    description: "Updates a deployment service definition in the project configuration (only when the config is managed by the dashboard). `env` replaces the service's whole env var set; resolvable vars are pushed to the deployment target if it has been provisioned (secret vars are pushed on the next deploy, when their values are supplied).",
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
      // Same shape as `deployments.services.<id>.env` in the config.
      env: yupRecord(
        yupString().matches(DEPLOYMENT_ENV_VAR_KEY_REGEX, "Invalid env var key"),
        deploymentEnvVarSchema.defined(),
      ).optional(),
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
    const requestEnv = body.env !== undefined ? envRecordFromRequestBody(body.env) : undefined;

    const definitionPatch = {
      framework: body.framework,
      installCommand: body.install_command,
      buildCommand: body.build_command,
      outputDirectory: body.output_directory,
      rootDirectory: body.root_directory,
    };
    // Resolved BEFORE the config write: static errors (self-references,
    // connections to nonexistent services/outputs) must reject the save
    // instead of persisting a typo that only surfaces at the next deploy.
    // Dynamic failures and secret entries are skipped (best-effort mode) — a
    // var whose type changed to "secret" keeps its old Vercel value until the
    // next deploy overwrites it — and the result is reused for the Vercel
    // write-through below.
    const resolvedEnv = requestEnv === undefined ? undefined : await resolveEnvVars({
      tenancy: auth.tenancy,
      prisma,
      serviceId: params.service_id,
      env: requestEnv,
      secrets: "best-effort-without-secrets",
    });
    const hasDefinitionChanges = Object.values(definitionPatch).some((value) => value !== undefined) || requestEnv !== undefined;
    if (hasDefinitionChanges) {
      // Env vars are part of the definition, so like the build fields they are
      // only editable when the dashboard owns the config.
      await assertServiceDefinitionsEditable(auth.tenancy);
      await updateServiceDefinitionInConfig(auth.tenancy, params.service_id, definitionPatch, requestEnv);
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
        ...(requestEnv !== undefined ? { env: requestEnv } : {}),
      };
    }

    if (requestEnv !== undefined && resolvedEnv !== undefined) {
      // Write-through to Vercel once the project exists; before provisioning
      // there's nothing to push (the first deploy pushes the current set).
      const service = await prisma.deploymentService.findUnique({
        where: {
          tenancyId_serviceId: {
            tenancyId: auth.tenancy.id,
            serviceId: params.service_id,
          },
        },
      });
      if (service?.vercelProjectId != null) {
        const client = getVercelDeploymentsClientOrThrow();
        try {
          await client.upsertEnvVars(service.vercelProjectId, resolvedEnv);
          // Keys removed from the definition are deleted from the Vercel
          // project so stale values can't linger in future builds.
          const newKeys = new Set(Object.keys(requestEnv));
          const vercelVars = await client.listEnvVarKeys(service.vercelProjectId);
          for (const vercelVar of vercelVars) {
            if (!newKeys.has(vercelVar.key)) {
              await client.deleteEnvVar(service.vercelProjectId, vercelVar.id);
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
