/**
 * Backend SAML 2.0 protocol wrapper around @node-saml/node-saml.
 *
 * Tests must NOT import from this file — drive the mock IdP via HTTP and
 * verify the backend's externally-observable behavior. Importing here would
 * make the backend its own oracle (the tests would just confirm it agrees
 * with itself), defeating the purpose of running an independent SAML
 * implementation in apps/mock-saml-idp.
 */
import { SAML } from "@node-saml/node-saml";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { DOMParser } from "@xmldom/xmldom";

/**
 * SAML connection config — the JSON shape stored under
 * tenancy.config.auth.saml.connections.[connectionId]. Defined here (rather
 * than imported from stack-shared) so the protocol wrapper can be built and
 * tested independently of the project-config schema.
 */
export type SamlConnectionConfig = {
  id: string,
  displayName: string,
  idpEntityId: string,
  idpSsoUrl: string,
  /** PEM-encoded X.509 cert used to verify assertion signatures. */
  idpCertificate: string,
  /** Optional email domain for /auth/saml/discover lookups. */
  domain?: string,
  /** Optional attribute name mapping. Defaults: email → "email", displayName → "displayName". */
  attributeMapping?: {
    email?: string,
    displayName?: string,
  },
};

/** SAML SP URLs derived from baseUrl + connectionId. Stable per deployment. */
export function spEntityId(baseUrl: string, connectionId: string): string {
  return `${baseUrl}/api/v1/auth/saml/metadata/${connectionId}`;
}

export function spAcsUrl(baseUrl: string, connectionId: string): string {
  return `${baseUrl}/api/v1/auth/saml/acs/${connectionId}`;
}

/** Strip PEM headers/whitespace — node-saml's idpCert wants the bare base64. */
function pemToBareCert(pemOrBare: string): string {
  return pemOrBare
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

/** Construct a node-saml client for a given connection. Cheap to call per-request. */
export function buildSamlClient(connection: SamlConnectionConfig, baseUrl: string): SAML {
  return new SAML({
    entryPoint: connection.idpSsoUrl,
    issuer: spEntityId(baseUrl, connection.id),
    callbackUrl: spAcsUrl(baseUrl, connection.id),
    idpCert: pemToBareCert(connection.idpCertificate),
    audience: spEntityId(baseUrl, connection.id),
    // V1: SP doesn't sign AuthnRequests and assertions aren't encrypted.
    // Per-connection toggles for both will land with signed/encrypted assertion support.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    signatureAlgorithm: "sha256",
    digestAlgorithm: "sha256",
    // Tolerate small clock skew between SP and IdP. SAML test #16 verifies
    // this tolerance is honored.
    acceptedClockSkewMs: 60 * 1000,
  });
}

/**
 * Extract the InResponseTo attribute from a SAMLResponse without verifying
 * the signature. Used by the ACS handler to look up the matching
 * SamlOuterInfo (and thus recover the tenancy) BEFORE calling node-saml's
 * full validation.
 *
 * Returns null if the attribute isn't present (which would be the case for
 * IdP-initiated SSO — out of scope for V1, so the caller treats null as
 * an error).
 */
export function extractInResponseTo(samlResponseB64: string): string | null {
  const xml = Buffer.from(samlResponseB64, "base64").toString("utf-8");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  return doc.documentElement.getAttribute("InResponseTo");
}

/**
 * Build the redirect URL the browser should follow to begin SAML SSO. Returns
 * both the URL and the AuthnRequest ID — the ID is stored in SamlOuterInfo
 * so the ACS handler can verify InResponseTo matches.
 */
export async function buildAuthnRequestUrl(
  client: SAML,
  relayState: string,
): Promise<{ url: string, requestId: string }> {
  const url = await client.getAuthorizeUrlAsync(relayState, undefined, {});
  const requestId = extractAuthnRequestId(url);
  return { url, requestId };
}

/**
 * Pull the AuthnRequest ID out of a built redirect URL by decoding the
 * SAMLRequest query param (base64 + DEFLATE) and reading the ID attribute.
 *
 * node-saml doesn't expose the generated ID directly, so we parse it back
 * out. This is a tiny, well-defined operation — uses xmldom rather than
 * regex so it copes with attribute order variations.
 */
function extractAuthnRequestId(redirectUrl: string): string {
  const params = new URL(redirectUrl).searchParams;
  const samlRequestB64 = params.get("SAMLRequest");
  if (!samlRequestB64) {
    throw new StackAssertionError("buildAuthnRequestUrl: redirect URL is missing SAMLRequest", { redirectUrl });
  }
  const compressed = Buffer.from(samlRequestB64, "base64");
  // Lazy import zlib — only loaded on the auth path, not at module load.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const xml = require("zlib").inflateRawSync(compressed).toString("utf-8") as string;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const id = doc.documentElement.getAttribute("ID");
  if (!id) {
    throw new StackAssertionError("buildAuthnRequestUrl: AuthnRequest is missing ID attribute", { xml });
  }
  return id;
}

export type ParsedAssertion = {
  nameId: string,
  nameIdFormat: string | null,
  inResponseTo: string | null,
  attributes: Record<string, string | string[]>,
  email: string | null,
  displayName: string | null,
};

/**
 * Verify the signature, audience, and timestamps on an incoming SAMLResponse,
 * then extract the NameID and mapped attributes.
 *
 * node-saml validates the signature against connection.idpCertificate,
 * checks audience matches our SP entity ID, validates NotBefore/NotOnOrAfter
 * with our 60s clock skew, and ensures InResponseTo matches the SAMLRequest
 * we issued (caller must verify the InResponseTo against SamlOuterInfo).
 */
export async function parseAndVerifyAssertion(
  client: SAML,
  connection: SamlConnectionConfig,
  samlResponseB64: string,
  relayState: string | undefined,
): Promise<ParsedAssertion> {
  const result = await client.validatePostResponseAsync({
    SAMLResponse: samlResponseB64,
    RelayState: relayState ?? "",
  });
  const profile = result.profile;
  if (!profile) {
    throw new StackAssertionError("validatePostResponseAsync returned no profile (was the user logged out?)");
  }

  const attributes = normalizeAttributes((profile.attributes ?? {}) as Record<string, unknown>);
  const emailAttr = connection.attributeMapping?.email ?? "email";
  const displayNameAttr = connection.attributeMapping?.displayName ?? "displayName";

  return {
    nameId: profile.nameID,
    nameIdFormat: profile.nameIDFormat,
    // node-saml types inResponseTo as a loose object; coerce to string defensively.
    inResponseTo: profile.inResponseTo ? String(profile.inResponseTo) : null,
    attributes,
    email: pickFirst(attributes[emailAttr]) ?? profile.nameID,
    displayName: pickFirst(attributes[displayNameAttr]) ?? null,
  };
}

function normalizeAttributes(raw: Record<string, unknown>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) {
      out[k] = v.map(String);
    } else if (v != null) {
      out[k] = String(v);
    }
  }
  return out;
}

function pickFirst(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * Generate the SP metadata XML that the customer's IdP admin will paste into
 * their IdP. Includes our entity ID + ACS URL + (when SP signing is added
 * later) the SP signing cert.
 */
export function getSpMetadataXml(connection: SamlConnectionConfig, baseUrl: string): string {
  const client = buildSamlClient(connection, baseUrl);
  return client.generateServiceProviderMetadata(null, null);
}
