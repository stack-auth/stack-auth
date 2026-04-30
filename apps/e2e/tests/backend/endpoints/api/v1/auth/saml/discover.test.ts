import { it } from "../../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../../backend-helpers";

/**
 * Tests for GET /auth/saml/discover.
 *
 * Test integrity: drives the API only — no imports from
 * apps/backend/src/saml/. Project config is set via the standard config
 * override endpoint (no special test-only mutator), so the discovery
 * lookup runs through the same code path real customers would hit.
 *
 * Connection isolation note: each `it` block creates its own project via
 * Project.createAndSwitch, so connections don't leak across tests.
 */

async function createProjectWithSamlConnection(slug: string, domain: string) {
  const { projectId } = await Project.createAndSwitch();
  // Set the entire connection entry as a single value. The override
  // system handles `auth.saml.connections.{id}: {full object}` cleanly,
  // but per-field deep dot-keys (e.g. .displayName) on a record entry
  // that doesn't yet exist get dropped during config normalization with
  // onDotIntoNonObject="ignore" — same convention as auth.oauth.providers
  // (see auth-methods/page-client.tsx).
  await Project.updateConfig({
    "apps.installed.saml-sso": { enabled: true },
    [`auth.saml.connections.${slug}`]: {
      displayName: `${slug} SSO`,
      allowSignIn: true,
      domain,
      idpEntityId: `https://idp.${domain}/saml/metadata`,
      idpSsoUrl: `https://idp.${domain}/saml/sso`,
      idpCertificate: "MIICertificatePlaceholderForDiscoveryTest=",
    },
  });
  return { projectId };
}

it("returns the matching connection for a known email domain", async ({ expect }) => {
  const { projectId } = await createProjectWithSamlConnection("acme", "acme.test");

  const response = await niceBackendFetch(
    `/api/v1/auth/saml/discover?email=alice@acme.test&project_id=${projectId}`,
    { method: "GET" },
  );

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "connection_id": "acme",
        "display_name": "acme SSO",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("returns 404 when no connection matches the email's domain", async ({ expect }) => {
  const { projectId } = await createProjectWithSamlConnection("acme", "acme.test");

  const response = await niceBackendFetch(
    `/api/v1/auth/saml/discover?email=stranger@unknown.test&project_id=${projectId}`,
    { method: "GET" },
  );

  expect(response.status).toBe(404);
});

it("matches the connection case-insensitively on the email domain", async ({ expect }) => {
  const { projectId } = await createProjectWithSamlConnection("acme", "acme.test");

  const response = await niceBackendFetch(
    `/api/v1/auth/saml/discover?email=ALICE@ACME.TEST&project_id=${projectId}`,
    { method: "GET" },
  );

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ connection_id: "acme", display_name: "acme SSO" });
});

it("returns 404 for an unknown project_id", async ({ expect }) => {
  await createProjectWithSamlConnection("acme", "acme.test");

  const response = await niceBackendFetch(
    `/api/v1/auth/saml/discover?email=alice@acme.test&project_id=00000000-0000-0000-0000-000000000000`,
    { method: "GET" },
  );

  expect(response.status).toBe(404);
});

it("returns SAML_SSO_NOT_ENABLED when the saml-sso app is not installed", async ({ expect }) => {
  // Same setup as createProjectWithSamlConnection but without enabling the app.
  // Configuring connections without installing the app should never let the
  // SDK use them — the alpha gate is the first line of defense.
  const { projectId } = await Project.createAndSwitch();
  await Project.updateConfig({
    "auth.saml.connections.acme": {
      displayName: "acme SSO",
      allowSignIn: true,
      domain: "acme.test",
      idpEntityId: "https://idp.acme.test/saml/metadata",
      idpSsoUrl: "https://idp.acme.test/saml/sso",
      idpCertificate: "MIICertificatePlaceholderForGateTest=",
    },
  });

  const response = await niceBackendFetch(
    `/api/v1/auth/saml/discover?email=alice@acme.test&project_id=${projectId}`,
    { method: "GET" },
  );

  expect(response.status).toBe(400);
  expect((response.body as { code?: string }).code).toBe("SAML_SSO_NOT_ENABLED");
});

it("returns 404 for a connection whose allowSignIn is disabled", async ({ expect }) => {
  // Discover is the entry point for signInWithSso — surfacing a disabled
  // connection here would direct the user through /auth/saml/login, which
  // intentionally 403s. Treat disabled connections as if they didn't exist.
  const { projectId } = await Project.createAndSwitch();
  await Project.updateConfig({
    "apps.installed.saml-sso": { enabled: true },
    "auth.saml.connections.acme": {
      displayName: "acme SSO",
      allowSignIn: false,
      domain: "acme.test",
      idpEntityId: "https://idp.acme.test/saml/metadata",
      idpSsoUrl: "https://idp.acme.test/saml/sso",
      idpCertificate: "MIICertificatePlaceholderForDisabledTest=",
    },
  });

  const response = await niceBackendFetch(
    `/api/v1/auth/saml/discover?email=alice@acme.test&project_id=${projectId}`,
    { method: "GET" },
  );

  expect(response.status).toBe(404);
});

it("isolates connections across projects (B's connection is not visible from A)", async ({ expect }) => {
  // Project A has acme; project B has globex. Querying A for globex's domain must miss.
  const { projectId: projectA } = await createProjectWithSamlConnection("acme", "acme.test");
  await createProjectWithSamlConnection("globex", "globex.test");

  const response = await niceBackendFetch(
    `/api/v1/auth/saml/discover?email=bob@globex.test&project_id=${projectA}`,
    { method: "GET" },
  );

  expect(response.status).toBe(404);
});
