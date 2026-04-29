import { it } from "../../../../../../helpers";
import { InternalApiKey, Project, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

/**
 * Tests for GET /auth/saml/login/[connection_id].
 *
 * Verifies the SDK-facing endpoint that begins SP-initiated SSO. We don't
 * follow the redirect into the IdP here — that's the round-trip test
 * (deferred). These tests check:
 * - URL is built correctly and points at the configured IdP SSO URL
 * - SAMLRequest + RelayState query params are present
 * - CSRF cookie is set in browser-redirect mode
 * - JSON-mode response returns the location instead of redirecting
 * - Error paths: invalid client, unknown connection, sign-in disabled
 */

async function setupProjectWithSamlConnection(slug: string, idpHost: string) {
  await Project.createAndSwitch();
  await InternalApiKey.createAndSetProjectKeys();
  await Project.updateConfig({
    [`auth.saml.connections.${slug}.displayName`]: `${slug} SSO`,
    [`auth.saml.connections.${slug}.allowSignIn`]: true,
    [`auth.saml.connections.${slug}.idpEntityId`]: `https://${idpHost}/saml/metadata`,
    [`auth.saml.connections.${slug}.idpSsoUrl`]: `https://${idpHost}/saml/sso`,
    [`auth.saml.connections.${slug}.idpCertificate`]: "MIICertificatePlaceholderForLoginTest=",
  });
}

function loginQuery() {
  const projectKeys = backendContext.value.projectKeys;
  if (projectKeys === "no-project") throw new Error("No project keys");
  const branchId = backendContext.value.currentBranchId;
  return {
    client_id: !branchId ? projectKeys.projectId : `${projectKeys.projectId}#${branchId}`,
    client_secret: projectKeys.publishableClientKey ?? "",
    redirect_uri: "http://localhost:8101/handler/oauth-callback",
    scope: "legacy",
    state: "this-is-some-state",
    grant_type: "authorization_code",
    code_challenge: "some-code-challenge",
    code_challenge_method: "S256",
    response_type: "code",
  };
}

it("returns the IdP SSO URL with SAMLRequest in JSON-mode", async ({ expect }) => {
  await setupProjectWithSamlConnection("acme", "idp.acme.test");

  const response = await niceBackendFetch("/api/v1/auth/saml/login/acme", {
    method: "GET",
    query: { ...loginQuery(), stack_response_mode: "json" },
  });

  expect(response.status).toBe(200);
  expect(typeof (response.body as { location?: unknown }).location).toBe("string");
  const location = new URL((response.body as { location: string }).location);
  expect(location.host).toBe("idp.acme.test");
  expect(location.pathname).toBe("/saml/sso");
  expect(location.searchParams.get("SAMLRequest")).toBeTruthy();
  expect(location.searchParams.get("RelayState")).toBe("this-is-some-state");
});

it("redirects + sets CSRF cookie in browser-redirect mode", async ({ expect }) => {
  await setupProjectWithSamlConnection("acme", "idp.acme.test");

  const response = await niceBackendFetch("/api/v1/auth/saml/login/acme", {
    method: "GET",
    redirect: "manual",
    query: loginQuery(),
  });

  expect(response.status).toBe(307);
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  expect(new URL(location!).host).toBe("idp.acme.test");
  // CSRF cookie keyed to the AuthnRequest ID — snapshot serializer strips
  // the suffix via the keyedCookieNamePrefixes registration.
  expect(response.headers.get("set-cookie")).toMatch(/^stack-saml-inner-[^;]+=true;/);
});

it("returns 404 for an unknown connection ID", async ({ expect }) => {
  await setupProjectWithSamlConnection("acme", "idp.acme.test");

  const response = await niceBackendFetch("/api/v1/auth/saml/login/does-not-exist", {
    method: "GET",
    query: loginQuery(),
  });

  expect(response.status).toBe(404);
});

it("returns 403 when allowSignIn is false on the connection", async ({ expect }) => {
  await setupProjectWithSamlConnection("acme", "idp.acme.test");
  await Project.updateConfig({ "auth.saml.connections.acme.allowSignIn": false });

  const response = await niceBackendFetch("/api/v1/auth/saml/login/acme", {
    method: "GET",
    query: loginQuery(),
  });

  expect(response.status).toBe(403);
});

it("rejects an invalid client_id", async ({ expect }) => {
  await setupProjectWithSamlConnection("acme", "idp.acme.test");

  const response = await niceBackendFetch("/api/v1/auth/saml/login/acme", {
    method: "GET",
    query: { ...loginQuery(), client_id: "00000000-0000-0000-0000-000000000000" },
  });

  // Tenancy lookup fails → InvalidOAuthClientIdOrSecret known error.
  expect(response.status).not.toBe(200);
  expect(response.status).not.toBe(307);
});
