import { getServiceRowOrThrow, marshalNamespaceForTenancy } from "@/lib/deployments";
import { MarshalApiError, getMarshalClientOrThrow, getMarshalDeploymentsConfigOrNull, sanitizeMarshalError } from "@/lib/deployments/marshal-client";
import { Tenancy } from "@/lib/tenancies";
import { PrismaClientTransaction, getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const authSchema = yupObject({
  type: serverOrHigherAuthTypeSchema,
  tenancy: adaptSchema.defined(),
}).defined();

const paramsSchema = yupObject({
  service_id: userSpecifiedIdSchema("serviceId").defined(),
  hostname: yupString().defined().lowercase(),
}).defined();

// Domains are purely operational state, so the row is the source of truth
// (the service itself must still exist in the project's configuration).
async function findDomainRowOrThrow(prisma: PrismaClientTransaction, tenancy: Tenancy, serviceId: string, hostname: string) {
  const service = await prisma.deploymentService.findUnique({
    where: {
      tenancyId_serviceId: {
        tenancyId: tenancy.id,
        serviceId,
      },
    },
  });
  const domain = service == null ? null : await prisma.deploymentServiceDomain.findUnique({
    where: {
      tenancyId_deploymentServiceId_hostname: {
        tenancyId: tenancy.id,
        deploymentServiceId: service.id,
        hostname,
      },
    },
  });
  if (service == null || domain == null) {
    throw new StatusError(404, `The domain ${JSON.stringify(hostname)} is not configured on this service.`);
  }
  return { service, domain };
}

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get deployment service domain",
    description: "Returns the verification state of a domain and the DNS records the user must create. Re-checks verification with the runtime on every read, so polling this endpoint picks up DNS changes.",
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
    body: yupObject({
      hostname: yupString().defined(),
      is_primary: yupBoolean().defined(),
      verified: yupBoolean().defined(),
      // True while the service has never been deployed: the runtime hasn't
      // been told about the domain yet, and the DNS targets (the app's IPs)
      // only exist once it has, so no records can be shown.
      pending_first_deploy: yupBoolean().defined(),
      dns_records: yupArray(yupObject({
        type: yupString().defined(),
        name: yupString().defined(),
        value: yupString().defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    await getServiceRowOrThrow(prisma, auth.tenancy, params.service_id);
    const { service, domain } = await findDomainRowOrThrow(prisma, auth.tenancy, params.service_id, params.hostname);

    if (service.provisionedAt == null || getMarshalDeploymentsConfigOrNull() == null) {
      // Not provisioned yet: the runtime doesn't know the domain and its DNS
      // targets don't exist yet — deploy first.
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          hostname: params.hostname,
          is_primary: domain.isPrimary,
          verified: false,
          pending_first_deploy: true,
          dns_records: [],
        },
      } as const;
    }

    const client = getMarshalClientOrThrow();
    let result;
    try {
      // A re-PUT of an already-attached domain is idempotent on Marshal and
      // returns the current certificate state + DNS records — it's the
      // "re-check now" primitive, the same role Vercel's verify call played.
      result = await client.putDomain(marshalNamespaceForTenancy(auth.tenancy), params.hostname, params.service_id);
    } catch (e) {
      if (e instanceof MarshalApiError && e.status === 404) {
        // Runtime spec is gone despite our provisionedAt (state reset); treat
        // like pre-first-deploy so the UI shows "deploy first".
        return {
          statusCode: 200,
          bodyType: "json",
          body: {
            hostname: params.hostname,
            is_primary: domain.isPrimary,
            verified: false,
            pending_first_deploy: true,
            dns_records: [],
          },
        } as const;
      }
      sanitizeMarshalError(e, "Checking the domain failed");
    }

    await prisma.deploymentServiceDomain.update({
      where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: domain.id } },
      data: { verified: result.verified },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        hostname: params.hostname,
        is_primary: domain.isPrimary,
        verified: result.verified,
        pending_first_deploy: false,
        // Once verified there is nothing left for the user to create; while
        // pending, the records include the ACME pre-issuance challenge.
        dns_records: result.verified ? [] : result.dns_records,
      },
    };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: {
    summary: "Remove domain from deployment service",
    description: "Removes a domain from a deployment service (runtime and operational state). The service stays running and internally reachable; its public IPs are released when the last domain is removed.",
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
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    await getServiceRowOrThrow(prisma, auth.tenancy, params.service_id);
    const { service, domain } = await findDomainRowOrThrow(prisma, auth.tenancy, params.service_id, params.hostname);

    if (service.provisionedAt != null && getMarshalDeploymentsConfigOrNull() != null) {
      try {
        await getMarshalClientOrThrow().deleteDomain(marshalNamespaceForTenancy(auth.tenancy), params.hostname);
      } catch (e) {
        // Already detached on the runtime (or never attached) — deleting the
        // row is still correct.
        if (!(e instanceof MarshalApiError && e.status === 404)) {
          sanitizeMarshalError(e, "Removing the domain failed");
        }
      }
    }
    await prisma.deploymentServiceDomain.deleteMany({
      where: {
        tenancyId: auth.tenancy.id,
        id: domain.id,
      },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { success: true },
    };
  },
});
