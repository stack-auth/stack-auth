import { assertGlobalDeploymentCapacity, assertMinInstancesAllowedByPlan, createDeployment, definitionFromServiceRow, deploymentToApiShape, encryptDeploymentRedactionSecrets, getServiceVolume, isTerminalDeploymentStatus, refreshDeploymentFromMarshal, resolveEnvVars, startDeployment } from "@/lib/deployments";
import { getMarshalDeploymentsConfigOrNull } from "@/lib/deployments/marshal-client";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { DEPLOYMENT_SOURCE_ID_REGEX, MAX_DEPLOYMENT_SOURCE_ID_LENGTH, deploymentSecretDefaultsSchema, type DeploymentServiceDefinition } from "@hexclave/shared/dist/deployments";
import type { MarshalEnvValue } from "@/lib/deployments/marshal-client";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

const DEPLOYMENT_INCLUDE = { source: { select: { sourceId: true } } } as const;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List deployments",
    description: "Lists deployments (one per `hexclave deploy`) newest first, across every deployment source, each reporting the source it came from and what each of its services did. Deployments still in flight are refreshed from the runtime on read.",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      limit: yupString().optional(),
      // Only this deployment source's deploys. The dashboard lists them all
      // together; a repository's own CI may want just its own.
      source_id: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(yupMixed().defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth, query }) => {
    const limit = query.limit == null ? 20 : parseInt(query.limit, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new StatusError(400, "limit must be an integer between 1 and 100");
    }
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const deployments = await prisma.deployment.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        ...(query.source_id != null ? { source: { sourceId: query.source_id } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: DEPLOYMENT_INCLUDE,
    });

    // Refresh only what is still in flight. A transient runtime error must not
    // 500 the whole listing — show last-known status instead.
    for (const deployment of deployments) {
      if (isTerminalDeploymentStatus(deployment.status) || getMarshalDeploymentsConfigOrNull() == null) continue;
      try {
        await refreshDeploymentFromMarshal(prisma, auth.tenancy, deployment);
      } catch (error) {
        captureError("deployments-list-refresh", error);
      }
    }
    const refreshed = await prisma.deployment.findMany({
      where: { tenancyId: auth.tenancy.id, id: { in: deployments.map((deployment) => deployment.id) } },
      orderBy: { createdAt: "desc" },
      include: DEPLOYMENT_INCLUDE,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { items: refreshed.map((deployment) => deploymentToApiShape(deployment)) },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Deploy a deployment source",
    description: "Deploys one deployment source from a previously uploaded source tree: every service the deploy file declares is built by ONE builder machine and then rolled out in dependency order. The services' STORED definitions (as last synced via PUT /deployments/services) are authoritative — connections are resolved server-side and secret env vars are filled from the project's stored secret values (Project Settings > Secrets), falling back to any `secret_defaults` sent with this request. Defaults are request-scoped and never stored. A secret with neither fails the deploy with the full list of keys that need a value. Returns as soon as the runtime has accepted the deployment; the build continues remotely, so poll the deployment endpoint for its status.",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      source_id: yupString()
        .defined()
        .max(MAX_DEPLOYMENT_SOURCE_ID_LENGTH, "deployment source ids may be at most ${max} characters long")
        .matches(DEPLOYMENT_SOURCE_ID_REGEX, "deployment source ids must contain only letters, numbers, underscores, dots, and hyphens (not starting with a dot or hyphen)"),
      upload_id: yupString().uuid().defined(),
      definition_sync_id: yupString().uuid().defined(),
      // The services to deploy, grouped into dependency LEVELS: everything in
      // one level is applied concurrently, and a level starts only once the
      // previous one has converged. A flat list would lose the ordering that
      // makes a `url` reference resolvable.
      levels: yupArray(yupArray(userSpecifiedIdSchema("serviceId").defined()).defined()).defined(),
      // The `secret(key, default)` defaults from the deploy file, keyed by
      // service id and then by env var key. Request-scoped: used only to fill
      // secrets that have no stored value, and never written to the database.
      secret_defaults: yupMixed().optional(),
      triggered_by: yupString().optional(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
      number: yupNumber().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    // Checked up front: a deploy on an unconfigured instance can never succeed,
    // so it must not consume the upload.
    if (getMarshalDeploymentsConfigOrNull() == null) {
      throw new StatusError(400, "Deployments are not configured on this Hexclave instance. Configure HEXCLAVE_MARSHAL_API_KEY (and HEXCLAVE_MARSHAL_URL) first.");
    }
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const plannedServiceIds = body.levels.flat();
    if (plannedServiceIds.length === 0) {
      throw new StatusError(400, "A deploy must name at least one service to deploy.");
    }
    if (new Set(plannedServiceIds).size !== plannedServiceIds.length) {
      throw new StatusError(400, "The same service appears in more than one dependency level.");
    }

    const source = await prisma.deploymentSource.findUnique({
      where: { tenancyId_sourceId: { tenancyId: auth.tenancy.id, sourceId: body.source_id } },
      select: { id: true, sourceId: true },
    });
    if (source == null) {
      throw new StatusError(400, `No deployment source ${JSON.stringify(body.source_id)} exists in this project. Sync its service definitions first (PUT /deployments/services).`);
    }

    const rows = await prisma.deploymentService.findMany({
      where: { tenancyId: auth.tenancy.id, serviceId: { in: plannedServiceIds } },
      include: { source: { select: { sourceId: true } } },
    });
    const rowsByServiceId = new Map(rows.map((row) => [row.serviceId, row]));

    const definitionsByServiceId = new Map<string, DeploymentServiceDefinition>();
    for (const serviceId of plannedServiceIds) {
      const row = rowsByServiceId.get(serviceId);
      if (row == null) {
        throw new StatusError(400, `No deployment service with id ${JSON.stringify(serviceId)} exists in this project. Sync the deploy file's definitions first (PUT /deployments/services).`);
      }
      if (row.sourceRowId !== source.id) {
        throw new StatusError(409, `The service ${JSON.stringify(serviceId)} belongs to the deployment source ${JSON.stringify(row.source.sourceId)}, so this deploy of ${JSON.stringify(source.sourceId)} cannot ship it. A deploy ships exactly the services of its own deploy file.`);
      }
      if (row.definitionSyncedAt == null || row.definitionSyncId == null) {
        throw new StatusError(400, `The deployment service ${JSON.stringify(serviceId)} has no synced definition. Run \`hexclave deploy\` with an up-to-date CLI.`);
      }
      if (row.definitionSyncId !== body.definition_sync_id) {
        throw new StatusError(409, `The deployment service ${JSON.stringify(serviceId)} changed after this deploy synced its definitions. Another deploy is using a newer deploy file; restart this deploy so its source and definitions come from the same revision.`);
      }
      definitionsByServiceId.set(serviceId, definitionFromServiceRow(row, await getServiceVolume(prisma, auth.tenancy, serviceId)));
    }

    // Re-check the plan against the STORED definitions. The sync checks too, but
    // only as CLI UX — this is the actual entitlement boundary, since a stored
    // definition can outlive the plan that was allowed to create it.
    await assertMinInstancesAllowedByPlan(auth.tenancy, Object.fromEntries(definitionsByServiceId));

    // Platform capacity, before the upload is consumed and before anything is
    // handed to the runtime. Only services that do not yet hold a Fly app count:
    // re-deploying what is already running provisions nothing new, so it must
    // keep working even at the ceiling.
    await assertGlobalDeploymentCapacity(
      auth.tenancy,
      plannedServiceIds.filter((serviceId) => rowsByServiceId.get(serviceId)?.provisionedAt == null).length,
    );

    // Resolve every service's env BEFORE consuming the upload: a missing secret
    // or a dangling connection must not spend it. One redaction snapshot covers
    // the whole deploy, because one build log does.
    const secretDefaults = parseSecretDefaults(body.secret_defaults);
    const resolvedEnvByServiceId = new Map<string, Record<string, MarshalEnvValue>>();
    const redactionSecrets = new Set<string>();
    for (const [serviceId, definition] of definitionsByServiceId) {
      const resolved = await resolveEnvVars({
        tenancy: auth.tenancy,
        prisma,
        serviceId,
        definition,
        secretDefaults: secretDefaults[serviceId] ?? {},
      });
      resolvedEnvByServiceId.set(serviceId, resolved.resolvedEnv);
      for (const secret of resolved.redactionSecrets) redactionSecrets.add(secret);
    }
    // A KMS failure must fail closed here: otherwise this build could exist
    // without a safe way to serve its logs.
    const redactionSecretsEncrypted = await encryptDeploymentRedactionSecrets([...redactionSecrets]);

    // Consume the upload before doing anything slow: this makes replaying the
    // same deploy request fail fast instead of deploying twice.
    const upload = await prisma.deploymentSourceUpload.findUnique({
      where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: body.upload_id } },
    });
    if (upload == null || upload.expiresAt < new Date()) {
      throw new StatusError(404, "Upload not found or expired. Create a new upload and try again.");
    }
    // deleteMany (not delete) so a concurrent duplicate request loses the race
    // with a clean 4xx instead of an unhandled P2025 500.
    const consumed = await prisma.deploymentSourceUpload.deleteMany({
      where: { tenancyId: auth.tenancy.id, id: body.upload_id },
    });
    if (consumed.count === 0) {
      throw new StatusError(409, "This upload was already consumed by another deploy request.");
    }

    // SERIALIZABLE: the deployment number is `max + 1` within the tenancy, so
    // the read and the insert have to be atomic. The unique index makes the
    // residual race a retry rather than two deployments printing as "#47".
    const deployment = await retryTransaction(prisma, async (transaction) => {
      return await createDeployment(transaction, auth.tenancy, {
        sourceRowId: source.id,
        triggeredBy: body.triggered_by ?? auth.type,
        plannedServiceIds,
      });
    }, { level: "serializable" });
    await prisma.deployment.update({
      where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: deployment.id } },
      data: { redactionSecretsEncrypted },
    });

    try {
      await startDeployment({
        tenancy: auth.tenancy,
        prisma,
        deploymentId: deployment.id,
        source,
        levels: body.levels,
        definitionsByServiceId,
        resolvedEnvByServiceId,
        marshalUploadId: upload.marshalUploadId,
      });
    } catch (error) {
      // The upload is consumed BEFORE this to fence concurrent duplicates, but
      // if the runtime then rejects the deployment the user's tarball is still
      // in the bucket and the deploy is retryable — so restore the upload row
      // rather than stranding it behind a misleading 404. Best-effort: a
      // concurrent retry may have re-created it.
      if (upload.expiresAt > new Date()) {
        try {
          await prisma.deploymentSourceUpload.create({
            data: { id: upload.id, tenancyId: auth.tenancy.id, marshalUploadId: upload.marshalUploadId, expiresAt: upload.expiresAt },
          });
        } catch (restoreError) {
          captureError("deployments-restore-upload-after-deploy-failure", restoreError);
        }
      }
      // The row exists and is now unreachable by the runtime; mark it failed so
      // it does not read as in-flight forever.
      await prisma.deployment.update({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: deployment.id } },
        data: { status: "FAILED", error: error instanceof StatusError ? error.message : "The runtime did not accept this deployment.", finishedAt: new Date() },
      });
      throw error;
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { id: deployment.id, number: deployment.number },
    };
  },
});

/**
 * `secret_defaults` is keyed by service id and then by env var key. Validated
 * here rather than in the request schema because yupRecord's key schema cannot
 * express "any service id" and a nested record at once without duplicating the
 * env-var-key rules; the inner shape is the same one the deploy file writes.
 */
function parseSecretDefaults(raw: unknown): Record<string, Record<string, string>> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new StatusError(400, "secret_defaults must be an object keyed by service id.");
  }
  const parsed: Record<string, Record<string, string>> = {};
  for (const [serviceId, defaults] of Object.entries(raw as Record<string, unknown>)) {
    const validated = deploymentSecretDefaultsSchema.validateSync(defaults, { strict: true });
    parsed[serviceId] = validated as Record<string, string>;
  }
  return parsed;
}
