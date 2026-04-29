import { it } from "../../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../../backend-helpers";

/**
 * Tests for GET /auth/saml/metadata/[connection_id].
 *
 * The IdP admin fetches this URL to wire up the SP side. We assert the
 * returned XML contains entityID + AssertionConsumerService URLs that
 * match what the IdP would actually need.
 */

async function setupSamlConnection(slug: string) {
  const { projectId } = await Project.createAndSwitch();
  await Project.updateConfig({
    [`auth.saml.connections.${slug}`]: {
      displayName: `${slug} SSO`,
      allowSignIn: true,
      idpEntityId: `https://idp.${slug}.test/saml/metadata`,
      idpSsoUrl: `https://idp.${slug}.test/saml/sso`,
      idpCertificate: "MIICertificatePlaceholderForMetadataTest=",
    },
  });
  return { projectId };
}

it("returns SP metadata XML with entityID and ACS URL embedded", async ({ expect }) => {
  const { projectId } = await setupSamlConnection("acme");

  const response = await niceBackendFetch(
    `/api/v1/auth/saml/metadata/acme?project_id=${projectId}`,
    { method: "GET" },
  );

  expect(response.status).toBe(200);
  expect(typeof response.body).toBe("string");
  const xml = response.body as string;
  // entityID should reference our metadata URL.
  expect(xml).toContain('entityID="');
  expect(xml).toContain("/api/v1/auth/saml/metadata/acme");
  // AssertionConsumerService should point at the ACS endpoint.
  expect(xml).toContain("/api/v1/auth/saml/acs/acme");
  // Must declare the HTTP-POST binding for the IdP to know where to POST.
  expect(xml).toContain("urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST");
});

it("returns 404 for an unknown connection ID", async ({ expect }) => {
  const { projectId } = await setupSamlConnection("acme");

  const response = await niceBackendFetch(
    `/api/v1/auth/saml/metadata/does-not-exist?project_id=${projectId}`,
    { method: "GET" },
  );

  expect(response.status).toBe(404);
});

it("returns 404 when the connection exists but has no IdP cert configured", async ({ expect }) => {
  const { projectId } = await Project.createAndSwitch();
  // Create a connection but skip the IdP-side fields.
  await Project.updateConfig({
    "auth.saml.connections.partial": {
      displayName: "Partial",
      allowSignIn: true,
      // No idpEntityId / idpSsoUrl / idpCertificate.
    },
  });

  const response = await niceBackendFetch(
    `/api/v1/auth/saml/metadata/partial?project_id=${projectId}`,
    { method: "GET" },
  );

  // Without the IdP fields, the SP metadata wouldn't be useful (the IdP
  // and SP need to know each other's cert for trust). Return 404.
  expect(response.status).toBe(404);
});
