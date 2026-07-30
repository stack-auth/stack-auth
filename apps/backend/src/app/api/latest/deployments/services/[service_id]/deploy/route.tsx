import { HEXCLAVE_SERVICE_ID, MAX_UPLOAD_BYTES, definitionFromServiceRow, encryptDeploymentRedactionSecrets, getServiceRowOrThrow, resolveEnvVars, startDeployment } from "@/lib/deployments";
import { getVercelDeploymentsConfigOrNull } from "@/lib/deployments/vercel-client";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { deleteBytes, downloadBytes, headBytes } from "@/s3";
import { deploymentSecretDefaultsSchema } from "@hexclave/shared/dist/deployments";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
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
    description: "Starts a deployment of a service from a previously uploaded source tarball. The service's STORED definition (as last synced from the config file's `services` export — sync first via PUT /deployments/services) is authoritative for the build: connections are resolved server-side and secret env vars are filled from the project's stored secret values (Project Settings > Secrets), falling back to any `secret_defaults` sent with this request. Defaults are request-scoped and never stored. A secret with neither fails the deploy with the full list of keys that need a value in the dashboard. The request returns a run id after the source files have been uploaded and Vercel has accepted the deployment; the remote build continues after that, so poll the run endpoint for its final status.",
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
      target: yupString().oneOf(["production", "preview"]).optional(),
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
    if (getVercelDeploymentsConfigOrNull() == null) {
      throw new StatusError(400, "Vercel deployments are not configured on this Hexclave instance. Configure HEXCLAVE_VERCEL_BEARER_TOKEN and HEXCLAVE_VERCEL_TEAM_ID first.");
    }
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const row = await getServiceRowOrThrow(prisma, auth.tenancy, params.service_id);
    // Rows that predate the services-export rework carry an empty default env
    // (their real definitions lived in the since-dropped config section).
    // Deploying one would build with no env vars AND reconcile the Vercel
    // project's env down to nothing — refuse until a sync stored the actual
    // definition.
    if (row.definitionSyncedAt == null || row.definitionSyncId == null) {
      throw new StatusError(400, `The deployment service ${JSON.stringify(params.service_id)} has no synced definition (it predates config-file-defined services). Add it to the \`services\` export of your hexclave.config.ts and run \`hexclave deploy\` with an up-to-date CLI.`);
    }
    if (row.definitionSyncId !== body.definition_sync_id) {
      throw new StatusError(409, `The deployment service ${JSON.stringify(params.service_id)} changed after this deploy synced its definitions. Another deploy is using a newer config; restart this deploy so its source and definition come from the same config revision.`);
    }
    const definition = definitionFromServiceRow(row);

    // Resolve env vars BEFORE consuming the upload: a missing secret or a
    // dangling connection must not spend the upload.
    const { resolvedEnvVars, redactionSecrets } = await resolveEnvVars({
      tenancy: auth.tenancy,
      prisma,
      serviceId: params.service_id,
      env: definition.env,
      secretDefaults: body.secret_defaults ?? {},
    });
    // Encrypt the complete per-run redaction set before consuming the upload
    // or starting any Vercel-side work. A KMS failure must fail closed here:
    // otherwise this build could exist without a safe way to serve its logs.
    const redactionSecretsEncrypted = await encryptDeploymentRedactionSecrets(redactionSecrets);

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
        redactionSecretsEncrypted,
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
