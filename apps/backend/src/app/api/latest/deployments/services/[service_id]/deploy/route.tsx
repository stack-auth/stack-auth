import { HEXCLAVE_SERVICE_ID, definitionFromServiceRow, encryptDeploymentRedactionSecrets, getServiceRowOrThrow, resolveEnvVars, startDeployment } from "@/lib/deployments";
import { getMarshalDeploymentsConfigOrNull } from "@/lib/deployments/marshal-client";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { deploymentSecretDefaultsSchema } from "@hexclave/shared/dist/deployments";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

// The deploy request only hands the upload reference to Marshal (the source
// tarball already sits in Marshal's bucket); the container build itself runs
// remotely, so this stays well within a normal function budget.
export const maxDuration = 60;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Deploy service",
    description: "Starts a deployment of a service from a previously uploaded source tarball. The service's STORED definition (as last synced from the config file's `services` export — sync first via PUT /deployments/services) is authoritative: connections are resolved server-side and secret env vars are filled from the project's stored secret values (Project Settings > Secrets), falling back to any `secret_defaults` sent with this request. Defaults are request-scoped and never stored. A secret with neither fails the deploy with the full list of keys that need a value in the dashboard. The request returns a run id once the runtime has accepted the spec; the container build continues remotely, so poll the run endpoint for its final status.",
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
      definition_sync_id: yupString().uuid().defined(),
      // Container services only have production deploys; the field stays so
      // an old CLI sending "production" explicitly keeps working, while
      // "preview" is rejected with a clear schema error.
      target: yupString().oneOf(["production"]).optional(),
      // The `secret(key, default)` defaults from the config file, keyed by env
      // var key. Request-scoped: used only to fill secrets that have no stored
      // value, and never written to the database.
      secret_defaults: deploymentSecretDefaultsSchema.optional(),
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
    // succeed, so it must not consume the upload.
    if (getMarshalDeploymentsConfigOrNull() == null) {
      throw new StatusError(400, "Deployments are not configured on this Hexclave instance. Configure HEXCLAVE_MARSHAL_API_KEY (and HEXCLAVE_MARSHAL_URL) first.");
    }
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const row = await getServiceRowOrThrow(prisma, auth.tenancy, params.service_id);
    // Rows that predate the services-export rework carry an empty default env
    // (their real definitions lived in the since-dropped config section).
    // Deploying one would run a container with no env vars and no port —
    // refuse until a sync stored the actual definition.
    if (row.definitionSyncedAt == null || row.definitionSyncId == null) {
      throw new StatusError(400, `The deployment service ${JSON.stringify(params.service_id)} has no synced definition (it predates config-file-defined services). Add it to the \`services\` export of your hexclave.config.ts and run \`hexclave deploy\` with an up-to-date CLI.`);
    }
    if (row.definitionSyncId !== body.definition_sync_id) {
      throw new StatusError(409, `The deployment service ${JSON.stringify(params.service_id)} changed after this deploy synced its definitions. Another deploy is using a newer config; restart this deploy so its source and definition come from the same config revision.`);
    }
    if (row.port == null) {
      throw new StatusError(400, `The deployment service ${JSON.stringify(params.service_id)} has no container port in its stored definition. Re-sync with an up-to-date CLI (\`hexclave deploy\`).`);
    }
    const definition = definitionFromServiceRow(row);

    // Resolve env vars BEFORE consuming the upload: a missing secret or a
    // dangling connection must not spend the upload.
    const { resolvedEnv, redactionSecrets } = await resolveEnvVars({
      tenancy: auth.tenancy,
      prisma,
      serviceId: params.service_id,
      env: definition.env,
      secretDefaults: body.secret_defaults ?? {},
    });
    // Encrypt the complete per-run redaction set before consuming the upload
    // or starting any runtime-side work. A KMS failure must fail closed here:
    // otherwise this build could exist without a safe way to serve its logs.
    const redactionSecretsEncrypted = await encryptDeploymentRedactionSecrets(redactionSecrets);

    // Consume the upload before doing anything slow: this makes replaying the
    // same deploy request fail fast instead of deploying twice. Marshal
    // additionally verifies the object exists and is within the size limit
    // when it accepts the spec (a slot that was never PUT to is its 400).
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

    const { runId } = await startDeployment({
      tenancy: auth.tenancy,
      prisma,
      serviceId: params.service_id,
      definition,
      resolvedEnv,
      redactionSecretsEncrypted,
      marshalUploadId: upload.marshalUploadId,
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
