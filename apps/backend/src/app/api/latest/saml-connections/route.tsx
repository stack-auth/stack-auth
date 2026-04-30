/**
 * Admin endpoints for managing SAML connections on a project.
 *
 * Connection config lives in tenancy.config.auth.saml.connections (JSON).
 * These endpoints are thin REST wrappers around the same config-override
 * mechanism the dashboard would otherwise call directly — they exist so
 * the dashboard's SSO list/detail pages don't have to compose key paths
 * manually.
 *
 * Admin access only. Per-project; the project is identified by the admin
 * auth context (no project_id in the URL).
 */
import { overrideEnvironmentConfigOverride, resetEnvironmentConfigOverrideKeys } from "@/lib/config";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { has } from "@stackframe/stack-shared/dist/utils/objects";

const samlConnectionResponseShape = yupObject({
  id: yupString().defined(),
  display_name: yupString().defined(),
  allow_sign_in: yupBoolean().defined(),
  domain: yupString().nullable().defined(),
  idp_entity_id: yupString().nullable().defined(),
  idp_sso_url: yupString().nullable().defined(),
  // idp_certificate intentionally truncated in list responses (it's long
  // and rarely needed); full cert is returned only by GET /[id].
  has_idp_certificate: yupBoolean().defined(),
});

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List SAML connections",
    description: "Admin: list every SAML connection configured on the project.",
    tags: ["Saml"],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(samlConnectionResponseShape).defined(),
    }).defined(),
  }),
  async handler({ auth }) {
    const connections = auth.tenancy.config.auth.saml.connections;
    type Conn = (typeof auth.tenancy.config.auth.saml.connections)[string];
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items: (Object.entries(connections) as Array<[string, Conn]>).map(([id, c]) => ({
          id,
          display_name: c.displayName,
          allow_sign_in: c.allowSignIn,
          domain: c.domain ?? null,
          idp_entity_id: c.idpEntityId ?? null,
          idp_sso_url: c.idpSsoUrl ?? null,
          has_idp_certificate: !!c.idpCertificate,
        })),
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create or update a SAML connection",
    description: "Admin: idempotent upsert by connection_id.",
    tags: ["Saml"],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      id: yupString().matches(/^[a-z0-9_-]+$/i).defined(),
      display_name: yupString().defined(),
      allow_sign_in: yupBoolean().defined(),
      domain: yupString().nullable().optional(),
      idp_entity_id: yupString().defined(),
      idp_sso_url: yupString().defined(),
      idp_certificate: yupString().defined(),
      attribute_mapping: yupObject({
        email: yupString().optional(),
        display_name: yupString().optional(),
      }).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: samlConnectionResponseShape,
  }),
  async handler({ auth, body }) {
    const exists = has(auth.tenancy.config.auth.saml.connections, body.id);
    const prefix = `auth.saml.connections.${body.id}`;
    const overlay: Record<string, unknown> = {};
    if (!exists) {
      // First-time create: write the whole record entry as a nested object.
      // Dotting into a missing parent record entry is silently dropped by
      // the config layer (see lib/config validateConfigOverrideSchema), so
      // child-only updates would 200 with no effect on a brand-new connection.
      const data: Record<string, unknown> = {
        displayName: body.display_name,
        allowSignIn: body.allow_sign_in,
        idpEntityId: body.idp_entity_id,
        idpSsoUrl: body.idp_sso_url,
        idpCertificate: body.idp_certificate,
      };
      if (body.domain !== undefined) data.domain = body.domain;
      if (body.attribute_mapping) {
        data.attributeMapping = {
          email: body.attribute_mapping.email,
          displayName: body.attribute_mapping.display_name,
        };
      }
      overlay[prefix] = data;
    } else {
      overlay[`${prefix}.displayName`] = body.display_name;
      overlay[`${prefix}.allowSignIn`] = body.allow_sign_in;
      overlay[`${prefix}.idpEntityId`] = body.idp_entity_id;
      overlay[`${prefix}.idpSsoUrl`] = body.idp_sso_url;
      overlay[`${prefix}.idpCertificate`] = body.idp_certificate;
      if (body.domain !== undefined) {
        overlay[`${prefix}.domain`] = body.domain;
      }
      if (body.attribute_mapping) {
        overlay[`${prefix}.attributeMapping`] = {
          email: body.attribute_mapping.email,
          displayName: body.attribute_mapping.display_name,
        };
      }
    }

    await overrideEnvironmentConfigOverride({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      environmentConfigOverrideOverride: overlay as Parameters<typeof overrideEnvironmentConfigOverride>[0]["environmentConfigOverrideOverride"],
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        id: body.id,
        display_name: body.display_name,
        allow_sign_in: body.allow_sign_in,
        domain: body.domain ?? null,
        idp_entity_id: body.idp_entity_id,
        idp_sso_url: body.idp_sso_url,
        has_idp_certificate: true,
      },
    };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: {
    summary: "Delete a SAML connection",
    description: "Admin: remove the connection. Existing user accounts linked via this connection remain in the database (they just become unable to sign in until a connection with the same id is recreated).",
    tags: ["Saml"],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    if (!has(auth.tenancy.config.auth.saml.connections, body.id)) {
      throw new StatusError(StatusError.NotFound, `SAML connection ${body.id} not found`);
    }
    await resetEnvironmentConfigOverrideKeys({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      keysToReset: [`auth.saml.connections.${body.id}`],
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { success: true },
    };
  },
});
