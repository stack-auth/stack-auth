/**
 * Full SAML SP-initiated round-trip e2e tests.
 *
 * Drives the entire flow against the running mock-saml-idp service on
 * port 8115:
 *
 *   1. Setup project with a SAML connection pointing at the mock IdP
 *      (cert fetched from mock metadata so it matches the mock's
 *      runtime-generated keypair).
 *   2. GET /auth/saml/login/[id] → returns the IdP redirect URL with a
 *      SAMLRequest.
 *   3. POST the SAMLRequest to mock /idp/[tenant]/login → mock returns
 *      auto-POST HTML containing a signed SAMLResponse + RelayState.
 *   4. POST that SAMLResponse to /auth/saml/acs/[id] → backend verifies
 *      the assertion and (for the happy path) issues a redirect with an
 *      OAuth code.
 *
 * Test integrity: NO imports from apps/backend/src/saml/. Mock IdP uses
 * `samlify` independently of the backend's `@node-saml/node-saml`, so
 * signature/canonicalization bugs in either library surface as test
 * failures rather than canceling out. Negative cases are produced by the
 * mock deliberately misbehaving via /test-controls — never by injecting
 * bad data into the backend's own validator.
 */
import { it, niceFetch } from "../../../../../../helpers";
import { localhostUrl } from "../../../../../../helpers/ports";
import { InternalApiKey, Project, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

const MOCK_SAML_BASE = localhostUrl("15");
const BACKEND_BASE = localhostUrl("02");

// ---------- helpers ----------

async function fetchMockIdpCertificate(tenantSlug: string): Promise<{
  entityId: string,
  ssoUrl: string,
  certificate: string,
}> {
  const res = await niceFetch(`${MOCK_SAML_BASE}/idp/${tenantSlug}/metadata`);
  if (res.status !== 200) {
    throw new Error(`Mock IdP returned ${res.status} for ${tenantSlug} metadata — is mock-saml-idp running on port 8115?`);
  }
  // application/xml content-type makes niceFetch return ArrayBuffer; decode it.
  const xml = typeof res.body === "string"
    ? res.body
    : new TextDecoder("utf-8").decode(res.body as ArrayBuffer);
  const entityIdMatch = xml.match(/entityID="([^"]+)"/);
  const ssoMatch = xml.match(/Binding="urn:oasis:names:tc:SAML:2\.0:bindings:HTTP-Redirect"[^>]*Location="([^"]+)"/);
  const certMatch = xml.match(/<X509Certificate>([\s\S]+?)<\/X509Certificate>/);
  if (!entityIdMatch || !ssoMatch || !certMatch) {
    throw new Error(`Could not parse mock IdP metadata for ${tenantSlug}`);
  }
  return {
    entityId: entityIdMatch[1],
    ssoUrl: ssoMatch[1],
    certificate: certMatch[1].replace(/\s+/g, ""),
  };
}

async function setupProjectWithMockSamlConnection(connectionId: string, tenantSlug: string) {
  await Project.createAndSwitch();
  await InternalApiKey.createAndSetProjectKeys();
  const idp = await fetchMockIdpCertificate(tenantSlug);
  await Project.updateConfig({
    [`auth.saml.connections.${connectionId}`]: {
      displayName: `${connectionId} SSO`,
      allowSignIn: true,
      idpEntityId: idp.entityId,
      idpSsoUrl: idp.ssoUrl,
      idpCertificate: idp.certificate,
    },
  });
  return { connectionId, tenantSlug };
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
    state: "round-trip-test-state",
    grant_type: "authorization_code",
    code_challenge: "round-trip-code-challenge",
    code_challenge_method: "S256",
    response_type: "code",
  };
}

/** Run the full happy-path SP-initiated SAML round trip. */
async function runSamlRoundTrip(options: {
  connectionId: string,
  tenantSlug: string,
  email: string,
  displayName?: string,
}) {
  // Step 1: get the IdP redirect URL (JSON mode so we can intercept).
  const loginRes = await niceBackendFetch(`/api/v1/auth/saml/login/${options.connectionId}`, {
    method: "GET",
    query: { ...loginQuery(), stack_response_mode: "json" },
  });
  if (loginRes.status !== 200) {
    throw new Error(`/auth/saml/login returned ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
  }
  const idpUrl = new URL((loginRes.body as { location: string }).location);
  const samlRequest = idpUrl.searchParams.get("SAMLRequest");
  const relayState = idpUrl.searchParams.get("RelayState") ?? "";
  if (!samlRequest) throw new Error("No SAMLRequest in IdP URL");

  // Step 2: POST to mock IdP /login endpoint with the form fields it expects.
  const idpLoginRes = await niceFetch(`${MOCK_SAML_BASE}/idp/${options.tenantSlug}/login`, {
    method: "POST",
    body: new URLSearchParams({
      SAMLRequest: samlRequest,
      RelayState: relayState,
      email: options.email,
      displayName: options.displayName ?? options.email.split("@")[0],
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  if (idpLoginRes.status !== 200) {
    throw new Error(`Mock IdP /login returned ${idpLoginRes.status}: ${idpLoginRes.body}`);
  }

  // Step 3: extract SAMLResponse from the auto-POST HTML.
  const html = typeof idpLoginRes.body === "string"
    ? idpLoginRes.body
    : new TextDecoder("utf-8").decode(idpLoginRes.body as ArrayBuffer);
  const samlResponseMatch = html.match(/name="SAMLResponse" value="([^"]+)"/);
  if (!samlResponseMatch) throw new Error(`Mock IdP did not return a SAMLResponse form: ${html.slice(0, 200)}`);
  const samlResponse = samlResponseMatch[1].replace(/&#x2F;/g, "/").replace(/&#x3D;/g, "=").replace(/&amp;/g, "&");

  // Step 4: POST to ACS — use niceFetch directly so URLSearchParams gets
  // sent as application/x-www-form-urlencoded. niceBackendFetch always
  // JSON.stringifies the body, which doesn't work for the IdP-style
  // form POST that ACS expects.
  const acsRes = await niceFetch(`${BACKEND_BASE}/api/v1/auth/saml/acs/${options.connectionId}`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({
      SAMLResponse: samlResponse,
      RelayState: relayState,
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

  return { loginRes, acsRes, samlResponse, relayState };
}

async function setMisbehavior(tenantSlug: string, body: Record<string, unknown>) {
  await niceFetch(`${MOCK_SAML_BASE}/idp/${tenantSlug}/test-controls`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

// ---------- tests ----------

it("full SP-initiated round trip: new user JIT-created", async ({ expect }) => {
  await setupProjectWithMockSamlConnection("acme", "acme");
  const { acsRes } = await runSamlRoundTrip({
    connectionId: "acme",
    tenantSlug: "acme",
    email: "alice@acme.test",
    displayName: "Alice",
  });
  // Successful ACS issues an OAuth code via oauthServer.authorize and
  // responds with a 303 redirect (or 307) to the customer's callback URL.
  expect([303, 307]).toContain(acsRes.status);
  const location = acsRes.headers.get("location");
  expect(location).toBeTruthy();
  const callbackUrl = new URL(location!);
  // Should contain an OAuth `code` query param.
  expect(callbackUrl.searchParams.get("code")).toBeTruthy();
});

it("rejects an assertion with the wrong audience", async ({ expect }) => {
  await setupProjectWithMockSamlConnection("acme", "acme");
  await setMisbehavior("acme", { kind: "wrong-audience" });
  const { acsRes } = await runSamlRoundTrip({
    connectionId: "acme",
    tenantSlug: "acme",
    email: "alice@acme.test",
  });
  // Audience mismatch must reject — no redirect to customer app with code.
  expect(acsRes.status).not.toBe(303);
  expect(acsRes.status).not.toBe(307);
  expect(acsRes.status).toBeGreaterThanOrEqual(400);
});

it("rejects an assertion signed by a different tenant (cross-connection forgery)", async ({ expect }) => {
  // Configure project with acme connection (acme's cert), but mock will
  // sign the assertion with globex's key. Backend must reject because the
  // signature won't verify against the configured cert.
  await setupProjectWithMockSamlConnection("acme", "acme");
  await setMisbehavior("acme", { kind: "bad-signature" });
  const { acsRes } = await runSamlRoundTrip({
    connectionId: "acme",
    tenantSlug: "acme",
    email: "alice@acme.test",
  });
  expect(acsRes.status).not.toBe(303);
  expect(acsRes.status).not.toBe(307);
  expect(acsRes.status).toBeGreaterThanOrEqual(400);
});

it("rejects an expired assertion", async ({ expect }) => {
  await setupProjectWithMockSamlConnection("acme", "acme");
  await setMisbehavior("acme", { kind: "expired" });
  const { acsRes } = await runSamlRoundTrip({
    connectionId: "acme",
    tenantSlug: "acme",
    email: "alice@acme.test",
  });
  expect(acsRes.status).not.toBe(303);
  expect(acsRes.status).not.toBe(307);
  expect(acsRes.status).toBeGreaterThanOrEqual(400);
});

it("rejects replay of a previously-consumed assertion", async ({ expect }) => {
  await setupProjectWithMockSamlConnection("acme", "acme");
  // First round trip completes successfully and consumes the OuterInfo.
  const first = await runSamlRoundTrip({
    connectionId: "acme",
    tenantSlug: "acme",
    email: "alice@acme.test",
  });
  expect([303, 307]).toContain(first.acsRes.status);

  // Replay the same SAMLResponse — backend should reject because the
  // SamlOuterInfo row was deleted at the end of the first ACS call, so
  // the InResponseTo lookup misses.
  const replayRes = await niceFetch(`${BACKEND_BASE}/api/v1/auth/saml/acs/acme`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({
      SAMLResponse: first.samlResponse,
      RelayState: first.relayState,
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  expect(replayRes.status).not.toBe(303);
  expect(replayRes.status).not.toBe(307);
  expect(replayRes.status).toBeGreaterThanOrEqual(400);
});
