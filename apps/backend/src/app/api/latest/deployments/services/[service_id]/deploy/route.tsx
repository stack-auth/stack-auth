import { ENV_VAR_KEY_REGEX, HEXCLAVE_SERVICE_ID, DeploymentServiceDefinition, createServiceDefinitionInConfig, domainKeyForHostname, listServiceDefinitions, normalizeHostnameOrThrow, startDeployment, updateServiceDefinitionInConfig } from "@/lib/deployments";
import { getBranchConfigOverrideSource, overrideBranchConfigOverride } from "@/lib/config";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupArray, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { filterUndefined } from "@hexclave/shared/dist/utils/objects";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Deploy service",
    description: "Starts a deployment of a service from a previously uploaded source tarball. The env set in the request is authoritative for this deploy: references are resolved server-side and pushed to the deployment target as encrypted env vars. Returns the run id immediately (fire-and-forget); poll the run endpoint for status.",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      service_id: userSpecifiedIdSchema("serviceId").defined(),
    }).defined(),
    body: yupObject({
      upload_id: yupString().uuid().defined(),
      target: yupString().oneOf(["production", "preview"]).optional(),
      build_config: yupObject({
        framework: yupString().optional(),
        install_command: yupString().optional(),
        build_command: yupString().optional(),
        output_directory: yupString().optional(),
        root_directory: yupString().optional(),
        domains: yupArray(yupString().defined()).optional(),
      }).optional(),
      env: yupArray(yupObject({
        key: yupString().defined().matches(ENV_VAR_KEY_REGEX, "Invalid env var key"),
        value: yupString().defined(),
      }).defined()).optional(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      run_id: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ auth, params, body }) => {
    if (params.service_id === HEXCLAVE_SERVICE_ID) {
      throw new StatusError(400, `The service id ${JSON.stringify(HEXCLAVE_SERVICE_ID)} is the managed Hexclave service and can't be deployed to.`);
    }
    // Validate every user-supplied hostname BEFORE consuming the upload, with
    // the same rules as the interactive add-domain route — otherwise a bad
    // domain would abort the deploy midway with the upload already spent.
    const requestedDomains = (body.build_config?.domains ?? []).map((hostname) => normalizeHostnameOrThrow(hostname));
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    // Consume the upload before doing anything slow: this makes replaying the
    // same deploy request fail fast instead of deploying twice.
    const upload = await prisma.deploymentSourceUpload.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: body.upload_id,
        },
      },
    });
    if (upload == null || upload.expiresAt < new Date()) {
      throw new StatusError(404, "Upload not found or expired. Create a new upload and try again.");
    }
    if (upload.data == null) {
      throw new StatusError(400, "The upload slot was created but no tarball was uploaded to it.");
    }
    // deleteMany (not delete) so a concurrent duplicate request loses the race
    // with a clean 4xx instead of an unhandled P2025 500.
    const consumed = await prisma.deploymentSourceUpload.deleteMany({
      where: {
        tenancyId: auth.tenancy.id,
        id: body.upload_id,
      },
    });
    if (consumed.count === 0) {
      throw new StatusError(409, "This upload was already consumed by another deploy request.");
    }

    const buildConfig = {
      framework: body.build_config?.framework,
      installCommand: body.build_config?.install_command,
      buildCommand: body.build_config?.build_command,
      outputDirectory: body.build_config?.output_directory,
      rootDirectory: body.build_config?.root_directory,
    };

    // Config-as-code: the deploy request's build config is upserted into the
    // service definition — but only when the dashboard owns the config or the
    // config was pushed via the CLI (same owner as the deploy). For
    // GitHub-sourced projects the repo is authoritative, so the definition must
    // already exist there and is left untouched.
    const source = await getBranchConfigOverrideSource({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
    });
    const existingDefinition = listServiceDefinitions(auth.tenancy).get(params.service_id);
    let definition: DeploymentServiceDefinition;
    if (source.type === "pushed-from-github") {
      definition = existingDefinition ?? throwServiceNotInGithubConfig(params.service_id);
    } else if (existingDefinition == null) {
      await createServiceDefinitionInConfig(auth.tenancy, params.service_id, filterUndefined(buildConfig));
      definition = { ...buildConfig, domains: {} };
    } else {
      await updateServiceDefinitionInConfig(auth.tenancy, params.service_id, filterUndefined(buildConfig));
      definition = { ...existingDefinition, ...filterUndefined(buildConfig) };
    }

    // Desired domains from the deploy request merge into the definition the
    // same way (additive; removing a domain is an explicit API/dashboard
    // action, not something a deploy does implicitly).
    if (requestedDomains.length > 0) {
      const newDomains: Record<string, { hostname: string }> = {};
      const domains = { ...definition.domains };
      for (const hostname of requestedDomains) {
        const key = domainKeyForHostname(hostname);
        if (Object.values(domains).some((d) => d.hostname === hostname)) continue;
        newDomains[key] = { hostname };
        domains[key] = { hostname, isPrimary: false };
      }
      if (Object.keys(newDomains).length > 0 && source.type !== "pushed-from-github") {
        await overrideBranchConfigOverride({
          projectId: auth.tenancy.project.id,
          branchId: auth.tenancy.branchId,
          branchConfigOverrideOverride: Object.fromEntries(Object.entries(newDomains).map(([key, value]) => [
            `deployments.services.${params.service_id}.domains.${key}`,
            value,
          ])),
        });
      }
      definition = { ...definition, domains };
    }

    const { runId } = await startDeployment({
      tenancy: auth.tenancy,
      prisma,
      serviceId: params.service_id,
      definition,
      buildConfig,
      envVars: body.env ?? [],
      target: body.target ?? "production",
      tarballGzipped: upload.data,
      // Informational only: which access type triggered the run ("server" =
      // secret-server-key i.e. CLI/CI, "admin" = a logged-in session).
      triggeredBy: auth.type,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { run_id: runId },
    };
  },
});

function throwServiceNotInGithubConfig(serviceId: string): never {
  throw new StatusError(400, `This project's configuration is managed by GitHub, and no deployment service with id ${JSON.stringify(serviceId)} is defined in it. Add a \`deployments.services.${serviceId}\` entry to your hexclave.config.ts and push it first.`);
}
