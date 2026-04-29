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
  // Push the SAML connection at the environment level — that's where the
  // IdP-side fields live. The discovery endpoint reads from the rendered
  // organization config which folds in env overrides.
  await Project.updateConfig({
    [`auth.saml.connections.${slug}.displayName`]: `${slug} SSO`,
    [`auth.saml.connections.${slug}.allowSignIn`]: true,
    [`auth.saml.connections.${slug}.domain`]: domain,
    [`auth.saml.connections.${slug}.idpEntityId`]: `https://idp.${domain}/saml/metadata`,
    [`auth.saml.connections.${slug}.idpSsoUrl`]: `https://idp.${domain}/saml/sso`,
    [`auth.saml.connections.${slug}.idpCertificate`]: "MIICertificatePlaceholderForDiscoveryTest=",
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
