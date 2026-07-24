import { HOSTNAME_REGEX, getOrCreateOperationalService, getServiceDefinitionOrThrow } from "@/lib/deployments";
import { VercelApiError, getVercelDeploymentsClientOrThrow, getVercelDeploymentsConfigOrNull, sanitizeVercelError } from "@/lib/deployments/vercel-client";
import { getPrismaClientForTenancy, isPrismaUniqueConstraintViolation } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Add domain to deployment service",
    description: "Adds a custom domain to a deployment service and, if the service has been provisioned, registers it with the deployment target. Domains are operational state (not part of the config-managed service definition), so they can be managed here regardless of where the project's configuration comes from. Read the domain endpoint afterwards for the DNS records to create.",
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
    getServiceDefinitionOrThrow(auth.tenancy, params.service_id);

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
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

    // Register with Vercel first (if provisioned): if Vercel rejects the
    // domain, nothing is persisted and the user gets the reason.
    let verified = false;
    if (service.vercelProjectId != null) {
      if (getVercelDeploymentsConfigOrNull() == null) {
        throw new StatusError(400, "Vercel deployments are not configured on this Hexclave instance.");
      }
      const client = getVercelDeploymentsClientOrThrow();
      try {
        const vercelDomain = await client.addProjectDomain(service.vercelProjectId, body.hostname);
        // Both ownership and DNS must be in place before the domain counts as
        // live; see the domain read route for why these are separate signals.
        verified = vercelDomain.verified && !await client.isDomainMisconfigured(body.hostname);
      } catch (e) {
        if (!(e instanceof VercelApiError && e.code === "domain_already_exists")) {
          sanitizeVercelError(e, "Adding the domain failed");
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
