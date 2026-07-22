import { assertServiceDefinitionsEditable, computeDnsRecords, getServiceDefinitionOrThrow } from "@/lib/deployments";
import { VercelApiError, getVercelDeploymentsClientOrThrow, sanitizeVercelError } from "@/lib/deployments/vercel-client";
import { overrideBranchConfigOverride } from "@/lib/config";
import { getPrismaClientForTenancy } from "@/prisma-client";
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

function findDefinitionDomainOrThrow(definition: { domains: Record<string, { hostname?: string, isPrimary?: boolean }> }, hostname: string) {
  const entry = Object.entries(definition.domains).find(([, d]) => d.hostname === hostname);
  if (entry == null) {
    throw new StatusError(404, `The domain ${JSON.stringify(hostname)} is not configured on this service.`);
  }
  return { key: entry[0], domain: entry[1] };
}

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get deployment service domain",
    description: "Returns the verification state of a domain and the DNS records the user must create. Re-checks verification with the deployment target on every read, so polling this endpoint picks up DNS changes.",
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
      // True while the service has never been deployed: Vercel hasn't been
      // told about the domain yet, so only the generic records are shown.
      pending_first_deploy: yupBoolean().defined(),
      dns_records: yupArray(yupObject({
        type: yupString().defined(),
        name: yupString().defined(),
        value: yupString().defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth, params }) => {
    const definition = getServiceDefinitionOrThrow(auth.tenancy, params.service_id);
    const { domain } = findDefinitionDomainOrThrow(definition, params.hostname);

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const service = await prisma.deploymentService.findUnique({
      where: {
        tenancyId_serviceId: {
          tenancyId: auth.tenancy.id,
          serviceId: params.service_id,
        },
      },
    });

    if (service?.vercelProjectId == null) {
      // Not provisioned yet: Vercel doesn't know the domain, but the A/CNAME
      // guidance is static, so the user can already set up their DNS.
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          hostname: params.hostname,
          is_primary: domain.isPrimary ?? false,
          verified: false,
          pending_first_deploy: true,
          dns_records: computeDnsRecords(params.hostname, guessApexName(params.hostname), undefined),
        },
      } as const;
    }

    const client = getVercelDeploymentsClientOrThrow();
    let vercelDomain;
    let misconfigured;
    try {
      // verify re-checks the ownership challenge on Vercel's side; the domain
      // config check covers the actual DNS records (A/CNAME). Both are
      // re-checked on every read, so polling this endpoint is what eventually
      // flips the domain to live. They are independent: an unclaimed domain is
      // "verified" (no ownership challenge needed) while its DNS still points
      // nowhere.
      try {
        vercelDomain = await client.verifyProjectDomain(service.vercelProjectId, params.hostname);
      } catch (e) {
        // Vercel's verify endpoint answers 4xx (e.g. missing_txt_record) when
        // the ownership challenge simply isn't satisfied yet. That's not an
        // error for us — it's the normal "pending" state, so fall back to a
        // plain read, which includes the outstanding challenges.
        if (!(e instanceof VercelApiError && e.status >= 400 && e.status < 500)) {
          throw e;
        }
        vercelDomain = await client.getProjectDomain(service.vercelProjectId, params.hostname);
      }
      misconfigured = await client.isDomainMisconfigured(params.hostname);
    } catch (e) {
      sanitizeVercelError(e, "Checking the domain failed");
    }
    const isLive = vercelDomain.verified && !misconfigured;

    await prisma.deploymentServiceDomain.upsert({
      where: {
        tenancyId_deploymentServiceId_hostname: {
          tenancyId: auth.tenancy.id,
          deploymentServiceId: service.id,
          hostname: params.hostname,
        },
      },
      update: { verified: isLive },
      create: {
        tenancyId: auth.tenancy.id,
        deploymentServiceId: service.id,
        hostname: params.hostname,
        isPrimary: domain.isPrimary ?? false,
        verified: isLive,
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        hostname: params.hostname,
        is_primary: domain.isPrimary ?? false,
        verified: isLive,
        pending_first_deploy: false,
        // TXT ownership challenges only apply while the ownership check is
        // pending; the A/CNAME guidance applies while DNS is misconfigured.
        dns_records: isLive ? [] : computeDnsRecords(params.hostname, vercelDomain.apexName, vercelDomain.verified ? undefined : vercelDomain.verification),
      },
    };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: {
    summary: "Remove domain from deployment service",
    description: "Removes a domain from a deployment service (definition, deployment target, and operational state).",
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
    const definition = getServiceDefinitionOrThrow(auth.tenancy, params.service_id);
    const { key } = findDefinitionDomainOrThrow(definition, params.hostname);
    await assertServiceDefinitionsEditable(auth.tenancy);

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const service = await prisma.deploymentService.findUnique({
      where: {
        tenancyId_serviceId: {
          tenancyId: auth.tenancy.id,
          serviceId: params.service_id,
        },
      },
    });
    if (service?.vercelProjectId != null) {
      try {
        await getVercelDeploymentsClientOrThrow().removeProjectDomain(service.vercelProjectId, params.hostname);
      } catch (e) {
        sanitizeVercelError(e, "Removing the domain failed");
      }
    }
    await overrideBranchConfigOverride({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      branchConfigOverrideOverride: {
        [`deployments.services.${params.service_id}.domains.${key}`]: null,
      },
    });
    if (service != null) {
      await prisma.deploymentServiceDomain.deleteMany({
        where: {
          tenancyId: auth.tenancy.id,
          deploymentServiceId: service.id,
          hostname: params.hostname,
        },
      });
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: { success: true },
    };
  },
});

// Best-effort apex guess for the not-yet-provisioned case (Vercel would tell
// us the real apexName). "app.example.com" -> "example.com"; two-label
// hostnames are treated as already-apex. Multi-part TLDs (e.g. .co.uk) are
// mis-guessed here, which only affects the provisional A-vs-CNAME hint shown
// before the first deploy — the post-deploy records come from Vercel.
function guessApexName(hostname: string): string {
  const parts = hostname.split(".");
  return parts.length <= 2 ? hostname : parts.slice(-2).join(".");
}
