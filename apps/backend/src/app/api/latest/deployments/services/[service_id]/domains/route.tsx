import { HOSTNAME_REGEX, definitionFromServiceRow, getOrCreateOperationalService, getServiceRowOrThrow, marshalNamespaceForTenancy } from "@/lib/deployments";
import { portTransport } from "@hexclave/shared/dist/deployments";
import { MarshalApiError, getMarshalClientOrThrow, getMarshalDeploymentsConfigOrNull, sanitizeMarshalError } from "@/lib/deployments/marshal-client";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError, StatusError, captureError } from "@hexclave/shared/dist/utils/errors";
import { randomUUID } from "node:crypto";

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
    const row = await getServiceRowOrThrow(prisma, auth.tenancy, params.service_id);
    // A domain terminates TLS and routes HTTP, so there must be an HTTP port to
    // route to. Without this the row is created, never verifies, and the runtime
    // rejection is deliberately swallowed at deploy time — a domain that silently
    // never works. Checked here rather than only at deploy so the 400 lands on
    // the request that can act on it.
    const ports = definitionFromServiceRow(row).ports;
    if (ports.length > 0 && !ports.some((entry) => portTransport(entry) === "http")) {
      throw new StatusError(400, `The deployment service ${JSON.stringify(params.service_id)} declares no HTTP port, so a custom domain has nothing to route to. Give it a port with transport: "http" first.`);
    }
    const service = await getOrCreateOperationalService(prisma, auth.tenancy, params.service_id);
    // Scoped to the whole tenancy, not just this service: the runtime holds ONE claim per
    // hostname, so attaching a hostname that another service in this project already has
    // would repoint the certificate on the runtime while leaving the old service's row
    // claiming it is still verified — a row that then advertises a URL routing elsewhere.
    const existing = await prisma.deploymentServiceDomain.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        hostname: body.hostname,
      },
    });
    if (existing != null) {
      throw new StatusError(400, existing.deploymentServiceId === service.id
        ? `The domain ${JSON.stringify(body.hostname)} is already added to this service.`
        : `The domain ${JSON.stringify(body.hostname)} is already added to another service in this project. Remove it there first.`);
    }

    // Reserve tenancy-wide ownership before touching Marshal. The unique index is the
    // concurrency arbiter: only the request that owns the row may attach the runtime claim.
    const domainId = randomUUID();
    const reservation = await prisma.deploymentServiceDomain.createMany({
      data: [{
        tenancyId: auth.tenancy.id,
        id: domainId,
        deploymentServiceId: service.id,
        hostname: body.hostname,
        isPrimary: body.is_primary ?? false,
        verified: false,
      }],
      skipDuplicates: true,
    });
    if (reservation.count === 0) {
      // Confirm the intended conflict after ON CONFLICT DO NOTHING. This distinguishes the
      // hostname race from an implausible generated-id collision or a future unique index.
      const raceWinner = await prisma.deploymentServiceDomain.findUnique({
        where: {
          tenancyId_hostname: {
            tenancyId: auth.tenancy.id,
            hostname: body.hostname,
          },
        },
      });
      if (raceWinner != null) {
        throw new StatusError(400, `The domain ${JSON.stringify(body.hostname)} is already added to a service in this project.`);
      }
      throw new HexclaveAssertionError("A deployment domain reservation was skipped without a hostname conflict");
    }
    let domain = await prisma.deploymentServiceDomain.findUniqueOrThrow({
      where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: domainId } },
    });

    let verified = domain.verified;
    if (service.provisionedAt != null) {
      if (getMarshalDeploymentsConfigOrNull() == null) {
        await prisma.deploymentServiceDomain.delete({ where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: domain.id } } });
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
          // The PUT may have reached Marshal before a network error. Release both sides
          // before returning the failure so retries cannot inherit a split-brain claim.
          try {
            await client.deleteDomain(marshalNamespaceForTenancy(auth.tenancy), body.hostname, params.service_id);
          } catch (cleanupError) {
            if (!(cleanupError instanceof MarshalApiError && cleanupError.status === 404)) {
              captureError("deployments-domain-add-runtime-compensation", cleanupError);
            }
          }
          await prisma.deploymentServiceDomain.delete({ where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: domain.id } } });
          sanitizeMarshalError(e, "Adding the domain failed");
        }
      }
    }

    if (verified !== domain.verified) {
      domain = await prisma.deploymentServiceDomain.update({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: domain.id } },
        data: { verified },
      });
    }

    return {
      statusCode: 201,
      bodyType: "json",
      body: {
        hostname: body.hostname,
        is_primary: domain.isPrimary,
        verified: domain.verified,
      },
    };
  },
});
