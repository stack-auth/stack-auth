import { it } from "../../../../helpers";
import { Project, niceBackendFetch } from "../../../backend-helpers";

/**
 * Tests for the admin /saml-connections CRUD endpoints.
 *
 * Regression target: a previous version wrote per-field deep dot-keys
 * (`auth.saml.connections.X.displayName`, ...) which were silently
 * dropped during config normalization when the parent record entry
 * didn't yet exist. POST returned 200 with the right body but persisted
 * nothing — the bug was only caught manually because the dashboard's
 * SSO page-client uses a different write path.
 */

async function setupProjectWithSamlAppEnabled() {
  await Project.createAndSwitch();
  await Project.updateConfig({
    "apps.installed.saml-sso": { enabled: true },
  });
}

it("POST /saml-connections persists the connection and GET returns it", async ({ expect }) => {
  await setupProjectWithSamlAppEnabled();

  const createRes = await niceBackendFetch("/api/v1/saml-connections", {
    method: "POST",
    accessType: "admin",
    body: {
      id: "acme",
      display_name: "Acme SSO",
      allow_sign_in: true,
      domain: "acme.test",
      idp_entity_id: "https://idp.acme.test/saml/metadata",
      idp_sso_url: "https://idp.acme.test/saml/sso",
      idp_certificate: "MIICertificatePlaceholderForCrudPersistTest=",
    },
  });
  expect(createRes.status).toBe(200);

  const listRes = await niceBackendFetch("/api/v1/saml-connections", {
    method: "GET",
    accessType: "admin",
  });
  expect(listRes.status).toBe(200);
  const items = (listRes.body as { items: Array<Record<string, unknown>> }).items;
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    id: "acme",
    display_name: "Acme SSO",
    allow_sign_in: true,
    domain: "acme.test",
    idp_entity_id: "https://idp.acme.test/saml/metadata",
    idp_sso_url: "https://idp.acme.test/saml/sso",
    has_idp_certificate: true,
  });

  // Single-connection GET returns the cert too.
  const getRes = await niceBackendFetch("/api/v1/saml-connections/acme", {
    method: "GET",
    accessType: "admin",
  });
  expect(getRes.status).toBe(200);
  expect((getRes.body as { idp_certificate: string }).idp_certificate)
    .toBe("MIICertificatePlaceholderForCrudPersistTest=");
});

it("POST /saml-connections returns SAML_SSO_NOT_ENABLED when the app is uninstalled", async ({ expect }) => {
  await Project.createAndSwitch();
  // Note: not enabling apps.installed.saml-sso.

  const res = await niceBackendFetch("/api/v1/saml-connections", {
    method: "POST",
    accessType: "admin",
    body: {
      id: "acme",
      display_name: "Acme SSO",
      allow_sign_in: true,
      idp_entity_id: "https://idp.acme.test/saml/metadata",
      idp_sso_url: "https://idp.acme.test/saml/sso",
      idp_certificate: "MIICertificatePlaceholderForGateTest=",
    },
  });
  expect(res.status).toBe(400);
  expect((res.body as { code?: string }).code).toBe("SAML_SSO_NOT_ENABLED");
});
