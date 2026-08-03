import { HOSTNAME_REGEX, getOrCreateOperationalService, getServiceRowOrThrow, marshalNamespaceForTenancy } from "@/lib/deployments";
import { MarshalApiError, getMarshalClientOrThrow, getMarshalDeploymentsConfigOrNull, sanitizeMarshalError } from "@/lib/deployments/marshal-client";
import { getPrismaClientForTenancy, isPrismaUniqueConstraintViolation } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Add domain to deployment service",
    description: "Adds a custom domain to a deployment service and, if the service has been provisioned, attaches it on the runtime (which allocates public IPs and requests a certificate). Domains are operational state (not part of the config-managed service definition), so they can be managed here regardless of where the project's configuration comes from. Read the domain endpoint afterwards for the DNS records to create.",
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
      hostname: yupString().defined().lowercase().matches(HOSTNAME_REGEX, "Invalid hostname (must be a bare hostname like app.example.com, not a URL)"),
      is_primary: yupBoolean().optional(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      hostname: yupString().defined(),
      is_primary: yupBoolean().defined(),
      verified: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ auth, params, body }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    await getServiceRowOrThrow(prisma, auth.tenancy, params.service_id);
    const service = await getOrCreateOperationalService(prisma, auth.tenancy, params.service_id);
    const existing = await prisma.deploymentServiceDomain.findUnique({
      where: {
        tenancyId_deploymentServiceId_hostname: {
          tenancyId: auth.tenancy.id,
          deploymentServiceId: service.id,
          hostname: body.hostname,
        },
      },
    });
    if (existing != null) {
      throw new StatusError(400, `The domain ${JSON.stringify(body.hostname)} is already added to this service.`);
    }

    // Attach on the runtime first (if provisioned): if Marshal rejects the
    // domain (e.g. the hostname is claimed by another project), nothing is
    // persisted and the user gets the reason. Before the first deploy the
    // runtime has no service to attach to, so the row alone records intent —
    // the deploy path pushes pending rows once the service is provisioned.
    let verified = false;
    if (service.provisionedAt != null) {
      if (getMarshalDeploymentsConfigOrNull() == null) {
        throw new StatusError(400, "Deployments are not configured on this Hexclave instance.");
      }
      const client = getMarshalClientOrThrow();
      try {
        const result = await client.putDomain(marshalNamespaceForTenancy(auth.tenancy), body.hostname, params.service_id);
        verified = result.verified;
      } catch (e) {
        if (e instanceof MarshalApiError && e.status === 404) {
          // Provisioned according to our row, but the runtime spec is gone
          // (e.g. the runtime state was reset). Keep the row-only path; the
          // next deploy re-attaches it.
        } else {
          sanitizeMarshalError(e, "Adding the domain failed");
        }
      }
    }

    try {
      await prisma.deploymentServiceDomain.create({
        data: {
          tenancyId: auth.tenancy.id,
          deploymentServiceId: service.id,
          hostname: body.hostname,
          isPrimary: body.is_primary ?? false,
          verified,
        },
      });
    } catch (e) {
      // Two concurrent adds of the same hostname both pass the existence check
      // above; the loser's unique-constraint violation must surface as the
      // same clean 400 the sequential path returns, not a 500.
      if (isPrismaUniqueConstraintViolation(e, "DeploymentServiceDomain", ["tenancyId", "deploymentServiceId", "hostname"])) {
        throw new StatusError(400, `The domain ${JSON.stringify(body.hostname)} is already added to this service.`);
      }
      throw e;
    }

    return {
      statusCode: 201,
      bodyType: "json",
      body: {
        hostname: body.hostname,
        is_primary: body.is_primary ?? false,
        verified,
      },
    };
  },
});
