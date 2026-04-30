import { getSoleTenancyFromProjectBranch, DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { getSpMetadataXml } from "@/saml/saml";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

/**
 * Public-fetchable SP metadata XML for a single SAML connection. The IdP
 * admin pastes this URL into their IdP UI to configure the SP side.
 *
 * V1 design: includes `?project_id=` because the connection ID alone
 * doesn't identify a tenancy (connection config lives in JSON, not a
 * Prisma table — we'd otherwise have to scan all tenancies). A reverse
 * index can be added later if this UX matters more.
 */
export const GET = createSmartRouteHandler({
  metadata: {
    summary: "SAML SP metadata",
    description: "Returns the Service Provider metadata XML for a SAML connection — paste into the IdP admin UI to configure the SP side.",
    tags: ["Saml"],
  },
  request: yupObject({
    params: yupObject({
      connection_id: yupString().defined(),
    }).defined(),
    query: yupObject({
      project_id: yupString().defined(),
      // Optional — SAML connections live under a tenancy/branch. If a
      // connection was created on a non-default branch, the IdP admin must
      // pass the same branch_id when fetching metadata so the SP entityId
      // matches what login (resolved from `client_id` = `projectId#branchId`)
      // will use.
      branch_id: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["text"]).defined(),
    body: yupString().defined(),
  }),
  async handler({ params, query }) {
    const tenancy = await getSoleTenancyFromProjectBranch(query.project_id, query.branch_id ?? DEFAULT_BRANCH_ID, true);
    if (!tenancy) {
      throw new StatusError(StatusError.NotFound, `Project ${query.project_id} not found`);
    }
    if (!(params.connection_id in tenancy.config.auth.saml.connections)) {
      throw new StatusError(StatusError.NotFound, `SAML connection ${params.connection_id} not found in project ${query.project_id}`);
    }
    const connection = tenancy.config.auth.saml.connections[params.connection_id];
    if (!connection.idpEntityId || !connection.idpSsoUrl || !connection.idpCertificate) {
      throw new StatusError(StatusError.NotFound, `SAML connection ${params.connection_id} is incompletely configured (missing IdP entity ID, SSO URL, or certificate)`);
    }

    // Canonical Stack Auth public API origin — must match login + ACS so the
    // SP entityId/audience the IdP signs against is consistent across the
    // whole flow.
    const baseUrl = getEnvVariable("NEXT_PUBLIC_STACK_API_URL");
    const xml = getSpMetadataXml({
      id: params.connection_id,
      displayName: connection.displayName,
      idpEntityId: connection.idpEntityId,
      idpSsoUrl: connection.idpSsoUrl,
      idpCertificate: connection.idpCertificate,
      domain: connection.domain,
      attributeMapping: connection.attributeMapping,
    }, baseUrl);

    return {
      statusCode: 200,
      bodyType: "text",
      body: xml,
    };
  },
});
