import { HEXCLAVE_SERVICE_ID, assertMinInstancesAllowedByPlan, definitionFromServiceRow, encryptDeploymentRedactionSecrets, getServiceRowOrThrow, resolveEnvVars, startDeployment } from "@/lib/deployments";
import { getMarshalDeploymentsConfigOrNull } from "@/lib/deployments/marshal-client";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { deploymentSecretDefaultsSchema } from "@hexclave/shared/dist/deployments";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

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
      // The deployment (from POST /deployments/deployments) this run belongs
      // to. Optional so a single service can be deployed directly through the
      // API without first creating a group; `hexclave deploy` always sends one.
      deployment_id: yupString().uuid().optional(),
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
      throw new StatusError(400, `The deployment service ${JSON.stringify(params.service_id)} has no synced definition (it predates config-file-defined services). Add it to \`deployment.services\` in your hexclave.config.ts and run \`hexclave deploy\` with an up-to-date CLI.`);
    }
    if (row.definitionSyncId !== body.definition_sync_id) {
      throw new StatusError(409, `The deployment service ${JSON.stringify(params.service_id)} changed after this deploy synced its definitions. Another deploy is using a newer config; restart this deploy so its source and definition come from the same config revision.`);
    }
    // No empty-ports guard here: an empty port list is a legitimate declaration
    // (a worker that only makes outbound connections). The case it used to catch
    // — a row that predates a synced definition — is already refused above by the
    // definitionSyncedAt/definitionSyncId check, which is the field that actually
    // means "no definition synced" rather than a value that merely correlates.
    const definition = definitionFromServiceRow(row);

    // Re-check the plan against the STORED definition. The sync route checks
    // too, but only as CLI UX — this is the actual entitlement boundary, since
    // a stored definition can outlive the plan that was allowed to create it
    // (a downgrade, or a row synced before the gate existed). Runs before
    // secrets are resolved or the upload is consumed.
    await assertMinInstancesAllowedByPlan(auth.tenancy, { [params.service_id]: definition });

    // Checked here rather than left to the run's foreign key: that key is only
    // enforced when the run row is created, which is AFTER the spec has been
    // applied and the build started. A bad id would then leave a live deploy
    // with no run row — no status, and no logs at all, since the logs route is
    // keyed by run id and the run holds the redaction secrets they need.
    if (body.deployment_id !== undefined) {
      const deployment = await prisma.deployment.findUnique({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.deployment_id } },
        select: { id: true },
      });
      if (deployment == null) {
        throw new StatusError(400, `No deployment with id ${JSON.stringify(body.deployment_id)} exists in this project. Create one with POST /deployments/deployments, or omit deployment_id to deploy this service on its own.`);
      }
    }

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

    let runId: string;
    try {
      // Re-check the definition immediately before the spec goes to the runtime. The check at
      // the top of this handler was several slow steps ago — a plan lookup, secret resolution,
      // a KMS round-trip and the upload consume — and a config sync landing in that window
      // would leave this deploy applying a definition the project has already moved off. The
      // sync id is a fresh uuid per sync, so an unchanged value means nothing was re-synced.
      //
      // Inside the try so that losing this race restores the upload, exactly like a failed
      // runtime PUT: the tarball is still good and the deploy is worth retrying.
      const current = await prisma.deploymentService.findUnique({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: row.id } },
        select: { definitionSyncId: true },
      });
      if (current?.definitionSyncId !== body.definition_sync_id) {
        throw new StatusError(409, `The deployment service ${JSON.stringify(params.service_id)} was re-synced while this deploy was being prepared. Another deploy is using a newer config; restart this deploy so its source and definition come from the same config revision.`);
      }

      ({ runId } = await startDeployment({
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
        deploymentId: body.deployment_id ?? null,
      }));
    } catch (error) {
      // The upload is consumed BEFORE the runtime PUT to fence concurrent duplicates, but if
      // the PUT then fails (bad spec, runtime outage) the user's tarball is still in Marshal's
      // bucket and the deploy is retryable — so restore the upload row rather than stranding
      // it behind a misleading 404. Best-effort: a concurrent retry may have re-created it.
      if (upload.expiresAt > new Date()) {
        try {
          await prisma.deploymentSourceUpload.create({
            data: { id: upload.id, tenancyId: auth.tenancy.id, marshalUploadId: upload.marshalUploadId, expiresAt: upload.expiresAt },
          });
        } catch (restoreError) {
          captureError("deployments-restore-upload-after-deploy-failure", restoreError);
        }
      }
      throw error;
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { run_id: runId },
    };
  },
});
