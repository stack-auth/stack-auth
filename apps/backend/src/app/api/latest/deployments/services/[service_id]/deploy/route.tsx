import { DeploymentServiceDefinition, HEXCLAVE_SERVICE_ID, SECRET_KEY_REGEX, createServiceDefinitionInConfig, envRecordFromRequestBody, listServiceDefinitions, resolveEnvVars, startDeployment, updateServiceDefinitionInConfig } from "@/lib/deployments";
import { getVercelDeploymentsConfigOrNull } from "@/lib/deployments/vercel-client";
import { getBranchConfigOverrideSource } from "@/lib/config";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { DEPLOYMENT_ENV_VAR_KEY_REGEX, deploymentEnvVarSchema } from "@hexclave/shared/dist/config/schema";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupNumber, yupObject, yupRecord, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Deploy service",
    description: "Starts a deployment of a service from a previously uploaded source tarball. The build config and env in the request (or, when omitted, the stored service definition) are authoritative for this deploy: connections are resolved server-side and secret env vars are filled from the request's secrets, then pushed to the deployment target as encrypted env vars. On GitHub-managed configs the request's build config and env still govern the BUILD, but are not persisted (the repo stays the source of truth). Returns the run id immediately (fire-and-forget); poll the run endpoint for status.",
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
      // null means "unset this field" (falls back to platform auto-detection)
      // — the CLI sends null for fields absent from the config file, so
      // deleting a field there actually takes effect; undefined means "leave
      // the stored value unchanged" (dashboard-mode deploys send nothing).
      build_config: yupObject({
        framework: yupString().nullable().optional(),
        install_command: yupString().nullable().optional(),
        build_command: yupString().nullable().optional(),
        output_directory: yupString().nullable().optional(),
        root_directory: yupString().nullable().optional(),
      }).optional(),
      // Same shape as `deployments.services.<id>.env` in the config — the CLI
      // sends its config file's env section verbatim (config-as-code).
      env: yupRecord(
        yupString().matches(DEPLOYMENT_ENV_VAR_KEY_REGEX, "Invalid env var key"),
        deploymentEnvVarSchema.defined(),
      ).optional(),
      // Values for the secret env vars of this deploy, keyed by the secret key
      // named in the env var definitions. Never persisted.
      secrets: yupRecord(
        yupString().matches(SECRET_KEY_REGEX, "Invalid secret key"),
        yupString().defined(),
      ).optional(),
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
    // Checked up front: a deploy on an unconfigured instance can never
    // succeed, so it must not consume the upload or write any config.
    if (getVercelDeploymentsConfigOrNull() == null) {
      throw new StatusError(400, "Vercel deployments are not configured on this Hexclave instance. Configure HEXCLAVE_VERCEL_BEARER_TOKEN and HEXCLAVE_VERCEL_TEAM_ID first.");
    }
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    // null = unset (delete the config key), undefined = leave unchanged.
    const buildConfig = {
      framework: body.build_config?.framework,
      installCommand: body.build_config?.install_command,
      buildCommand: body.build_config?.build_command,
      outputDirectory: body.build_config?.output_directory,
      rootDirectory: body.build_config?.root_directory,
    };

    // Config-as-code: the deploy request's build config and env are upserted
    // into the service definition — but only when the dashboard owns the
    // config or the config was pushed via the CLI (same owner as the deploy).
    // For GitHub-sourced projects the repo is authoritative, so the definition
    // must already exist there and is left untouched.
    const source = await getBranchConfigOverrideSource({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
    });
    const existingDefinition = listServiceDefinitions(auth.tenancy).get(params.service_id);
    if (source.type === "pushed-from-github" && existingDefinition == null) {
      throwServiceNotInGithubConfig(params.service_id);
    }
    // Like the build config, the request's env set wins for THIS build even on
    // GitHub-sourced projects (the CLI sends the same config file content the
    // repo holds) — only the persistence below is skipped for them.
    const requestEnv = body.env !== undefined ? envRecordFromRequestBody(body.env) : undefined;
    const mergeField = (requested: string | null | undefined, stored: string | undefined) =>
      requested === null ? undefined : requested ?? stored;
    const definition: DeploymentServiceDefinition = {
      type: existingDefinition?.type ?? "vercel",
      framework: mergeField(buildConfig.framework, existingDefinition?.framework),
      installCommand: mergeField(buildConfig.installCommand, existingDefinition?.installCommand),
      buildCommand: mergeField(buildConfig.buildCommand, existingDefinition?.buildCommand),
      outputDirectory: mergeField(buildConfig.outputDirectory, existingDefinition?.outputDirectory),
      rootDirectory: mergeField(buildConfig.rootDirectory, existingDefinition?.rootDirectory),
      env: requestEnv ?? existingDefinition?.env ?? {},
    };

    // Resolve env vars BEFORE consuming the upload: a missing secret or a
    // dangling connection must not spend the upload (or write any config).
    const resolvedEnvVars = await resolveEnvVars({
      tenancy: auth.tenancy,
      prisma,
      serviceId: params.service_id,
      env: definition.env,
      secrets: new Map(Object.entries(body.secrets ?? {})),
    });

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

    if (source.type !== "pushed-from-github") {
      if (existingDefinition == null) {
        await createServiceDefinitionInConfig(auth.tenancy, params.service_id, {
          framework: definition.framework,
          installCommand: definition.installCommand,
          buildCommand: definition.buildCommand,
          outputDirectory: definition.outputDirectory,
          rootDirectory: definition.rootDirectory,
          env: definition.env,
        });
      } else {
        // One combined write: the null build fields delete their config keys,
        // and the env (when provided) replaces the whole set.
        await updateServiceDefinitionInConfig(auth.tenancy, params.service_id, buildConfig, requestEnv);
      }
    }

    const { runId } = await startDeployment({
      tenancy: auth.tenancy,
      prisma,
      serviceId: params.service_id,
      definition,
      resolvedEnvVars,
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
