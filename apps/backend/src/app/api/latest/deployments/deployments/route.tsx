import { createDeployment, deploymentToApiShape, isTerminalRunStatus, refreshRunFromMarshal } from "@/lib/deployments";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

// Runs are loaded with the service id they belong to so a deployment can list
// its services without a second query per run.
const RUNS_INCLUDE = {
  runs: {
    include: { service: { select: { serviceId: true } } },
    orderBy: { createdAt: "asc" },
  },
} as const;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List deployments",
    description: "Lists deployments (one per `hexclave deploy`) newest first, each with the services it deployed and their runs. Non-terminal runs are refreshed from the deployment target on read.",
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
      where: { tenancyId: auth.tenancy.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: RUNS_INCLUDE,
    });

    // Refresh only what is still in flight. A transient Marshal error must not
    // 500 the whole listing — show last-known status instead (matches the
    // per-service runs route).
    for (const deployment of deployments) {
      for (const run of deployment.runs) {
        if (isTerminalRunStatus(run.status)) continue;
        try {
          await refreshRunFromMarshal(prisma, auth.tenancy, run, run.service.serviceId);
        } catch (e) {
          captureError("deployments-list-refresh", e);
        }
      }
    }
    // Re-read rather than patching the in-memory rows: refreshRunFromMarshal
    // writes through, and re-reading is what keeps the derived deployment status
    // consistent with the runs it was computed from.
    const refreshed = await prisma.deployment.findMany({
      where: { tenancyId: auth.tenancy.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: RUNS_INCLUDE,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { items: refreshed.map(deploymentToApiShape) },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create deployment",
    description: "Creates the deployment that a multi-service `hexclave deploy` groups its per-service runs under. Returns its id, which the deploy route accepts as `deployment_id`.",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      // Container services only have production deploys; the field stays for
      // symmetry with the run's target and to reject "preview" clearly.
      target: yupString().oneOf(["production"]).optional(),
      triggered_by: yupString().optional(),
      // The services this deploy intends to deploy, in dependency order. Stored
      // so a service whose dependency fails — and therefore never gets a run —
      // still appears in the deployment as skipped.
      //
      // DUPLICATES ARE REFUSED. The plan is what the deployment's derived status
      // counts against, so a repeated id makes a fully successful deploy count
      // one run for two planned entries: it reads as `building` forever, then
      // `failed` once concluded, and lists the service twice.
      planned_service_ids: yupArray(userSpecifiedIdSchema("serviceId").defined())
        .test(
          "unique-planned-service-ids",
          "planned_service_ids must not contain the same service id twice",
          (value) => value == null || new Set(value).size === value.length,
        )
        .defined(),
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
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    // The number is `max + 1`, so the read and the insert must be one
    // transaction: two concurrent deploys (CI and a laptop) would otherwise both
    // read 46 and the loser would fail the unique index with a 500. retryTransaction
    // turns that into a retry that picks 48.
    const created = await retryTransaction(prisma, async (transaction) => await createDeployment(transaction, auth.tenancy, {
      target: body.target ?? "production",
      triggeredBy: body.triggered_by ?? "cli",
      plannedServiceIds: body.planned_service_ids,
    }), { level: "serializable" });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { id: created.id, number: created.number },
    };
  },
});
