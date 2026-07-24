import { DeploymentServiceDefinition, HEXCLAVE_SERVICE_ID, MAX_UPLOAD_BYTES, SECRET_KEY_REGEX, createServiceDefinitionInConfig, envRecordFromRequestBody, listServiceDefinitions, resolveEnvVars, startDeployment, updateServiceDefinitionInConfig } from "@/lib/deployments";
import { getVercelDeploymentsConfigOrNull } from "@/lib/deployments/vercel-client";
import { getBranchConfigOverrideSource } from "@/lib/config";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { deleteBytes, downloadBytes, headBytes } from "@/s3";
import { DEPLOYMENT_ENV_VAR_KEY_REGEX, deploymentEnvVarSchema } from "@hexclave/shared/dist/config/schema";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupNumber, yupObject, yupRecord, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

// Source fan-out is intentionally synchronous for the MVP; make the expected
// Vercel Function budget explicit instead of inheriting a shorter default.
export const maxDuration = 300;

async function deleteDeploymentSourceObject(objectKey: string): Promise<void> {
  try {
    await deleteBytes({ key: objectKey, private: true });
  } catch (error) {
    // The R2 lifecycle rule is the final safety net for cleanup failures. The
    // deployment result must not be hidden by a failed best-effort delete.
    captureError("deployments-delete-source-object", error);
  }
}

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Deploy service",
    description: "Starts a deployment of a service from a previously uploaded source tarball. The build config and env in the request (or, when omitted, the stored service definition) are authoritative for this deploy: connections are resolved server-side and secret env vars are filled from the request's secrets, then pushed to the deployment target as encrypted env vars. On GitHub-managed configs the request's build config and env still govern the BUILD, but are not persisted (the repo stays the source of truth). The request returns a run id after the source files have been uploaded and Vercel has accepted the deployment; the remote build continues after that, so poll the run endpoint for its final status.",
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
    const objectMetadata = await headBytes({ key: upload.objectKey, private: true });
    if (objectMetadata == null) {
      throw new StatusError(400, "The upload slot was created but no tarball was uploaded to it.");
    }
    if (objectMetadata.byteLength === 0) {
      await prisma.deploymentSourceUpload.deleteMany({
        where: { tenancyId: auth.tenancy.id, id: body.upload_id },
      });
      await deleteDeploymentSourceObject(upload.objectKey);
      throw new StatusError(400, "The uploaded tarball is empty.");
    }
    if (objectMetadata.byteLength > MAX_UPLOAD_BYTES) {
      await prisma.deploymentSourceUpload.deleteMany({
        where: { tenancyId: auth.tenancy.id, id: body.upload_id },
      });
      await deleteDeploymentSourceObject(upload.objectKey);
      throw new StatusError(StatusError.PayloadTooLarge, `The uploaded tarball is too large (max ${MAX_UPLOAD_BYTES} bytes).`);
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

    try {
      // Bind the download to the exact object version inspected above. A
      // presigned PUT URL remains usable until expiry, so If-Match prevents an
      // overwrite racing between our size check and download.
      const tarballGzipped = await downloadBytes({
        key: upload.objectKey,
        private: true,
        ifMatch: objectMetadata.eTag,
      });
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

      // Intentionally synchronous for the MVP so provisioning and source-upload
      // failures reach the CLI. Do not replace this with waitUntil: function
      // termination would lose the deployment. Move this phase to a durable
      // worker before increasing the source/file limits substantially.
      const { runId } = await startDeployment({
        tenancy: auth.tenancy,
        prisma,
        serviceId: params.service_id,
        definition,
        resolvedEnvVars,
        target: body.target ?? "production",
        tarballGzipped,
        // Informational only: which access type triggered the run ("server" =
        // secret-server-key i.e. CLI/CI, "admin" = a logged-in session).
        triggeredBy: auth.type,
      });

      return {
        statusCode: 200,
        bodyType: "json",
        body: { run_id: runId },
      };
    } finally {
      await deleteDeploymentSourceObject(upload.objectKey);
    }
  },
});

function throwServiceNotInGithubConfig(serviceId: string): never {
  throw new StatusError(400, `This project's configuration is managed by GitHub, and no deployment service with id ${JSON.stringify(serviceId)} is defined in it. Add a \`deployments.services.${serviceId}\` entry to your hexclave.config.ts and push it first.`);
}
