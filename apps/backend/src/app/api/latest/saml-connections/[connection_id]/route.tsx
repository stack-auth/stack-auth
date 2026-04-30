/**
 * Admin GET for a single SAML connection — returns the full config
 * including idp_certificate. Use this for the dashboard's detail page;
 * the list endpoint omits the cert.
 */
import { adaptSchema, adminAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get a SAML connection",
    description: "Admin: full connection config including the IdP certificate.",
    tags: ["Saml"],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    params: yupObject({
      connection_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
      display_name: yupString().defined(),
      allow_sign_in: yupBoolean().defined(),
      domain: yupString().nullable().defined(),
      idp_entity_id: yupString().nullable().defined(),
      idp_sso_url: yupString().nullable().defined(),
      idp_certificate: yupString().nullable().defined(),
      attribute_mapping: yupObject({
        email: yupString().optional(),
        display_name: yupString().optional(),
      }).nullable().defined(),
    }).defined(),
  }),
  async handler({ auth, params }) {
    if (!auth.tenancy.config.apps.installed["saml-sso"]?.enabled) {
      throw new KnownErrors.SamlSsoNotEnabled();
    }
    if (!(params.connection_id in auth.tenancy.config.auth.saml.connections)) {
      throw new StatusError(StatusError.NotFound, `SAML connection ${params.connection_id} not found`);
    }
    const conn = auth.tenancy.config.auth.saml.connections[params.connection_id];
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        id: params.connection_id,
        display_name: conn.displayName,
        allow_sign_in: conn.allowSignIn,
        domain: conn.domain ?? null,
        idp_entity_id: conn.idpEntityId ?? null,
        idp_sso_url: conn.idpSsoUrl ?? null,
        idp_certificate: conn.idpCertificate ?? null,
        attribute_mapping: conn.attributeMapping
          ? { email: conn.attributeMapping.email, display_name: conn.attributeMapping.displayName }
          : null,
      },
    };
  },
});
