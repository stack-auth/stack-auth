/**
 * Mock SAML 2.0 Identity Provider for e2e tests + local development.
 *
 * Multi-tenant: serves N virtual IdPs under /idp/:tenant/. Each tenant has
 * its own RSA keypair + self-signed cert generated at startup. This lets one
 * mock service back many SamlConnection rows in tests and exercise per-
 * connection isolation.
 *
 * IMPORTANT: Uses `samlify` deliberately because the backend SAML wrapper
 * (added in the stacked backend PR) uses `@node-saml/node-saml`. Different
 * libraries on each side means a bug in either library's signature
 * canonicalization surfaces as a test failure instead of being masked by
 * both sides agreeing.
 */
import express from 'express';
import handlebars from 'handlebars';
import forge from 'node-forge';
import * as samlify from 'samlify';

const stackPortPrefix = process.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? "81";
const defaultPort = Number(`${stackPortPrefix}42`);
const port = Number(process.env.STACK_SAML_MOCK_PORT ?? process.env.PORT ?? defaultPort);
const tenantSlugs = (process.env.STACK_MOCK_SAML_TENANTS ?? "acme,globex").split(",").map(s => s.trim()).filter(Boolean);

// samlify requires a schema validator. For a test mock we skip XSD validation
// so we don't need to ship the SAML schema files.
samlify.setSchemaValidator({
  validate: async () => "skipped",
});

type Misbehavior =
  | { kind: 'none' }
  | { kind: 'bad-signature' }                    // sign with another tenant's key
  | { kind: 'expired' }                          // NotOnOrAfter in the past
  | { kind: 'not-yet-valid' }                    // NotBefore in the far future
  | { kind: 'wrong-audience' }                   // Audience set to "https://wrong.example/"
  | { kind: 'wrong-in-response-to' }             // InResponseTo set to a random ID
  | { kind: 'missing-name-id' }                  // strip the <NameID>
  | { kind: 'missing-email' }                    // omit the email attribute
  | { kind: 'replay' }                           // emit the previous tenant's response again
  | { kind: 'sign-with-tenant', tenant: string } // sign with a specified tenant's key
;

type TenantState = {
  slug: string,
  entityId: string,
  privateKeyPem: string,
  certPem: string,
  certForMetadata: string, // cert with PEM headers stripped, base64-only (per SAML spec)
  idp: ReturnType<typeof samlify.IdentityProvider>,
  // Pending misbehavior consumed on the next assertion. Cleared after one use.
  nextMisbehavior: Misbehavior,
  // Last successful response context, used for the `replay` misbehavior.
  lastResponse: { samlResponseB64: string, relayState: string, acsUrl: string } | null,
};

const tenants = new Map<string, TenantState>();

// ---------- key + cert generation ----------------------------------------

function generateSelfSignedCert(commonName: string): { privateKeyPem: string, certPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'Stack Auth Mock SAML IdP' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certPem: forge.pki.certificateToPem(cert),
  };
}

function pemToBase64Cert(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

function entityIdFor(slug: string): string {
  return `http://localhost:${port}/idp/${slug}/metadata`;
}

function ssoUrlFor(slug: string): string {
  return `http://localhost:${port}/idp/${slug}/sso`;
}

function buildIdpMetadataXml(tenant: TenantState): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
                  entityID="${tenant.entityId}">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" WantAuthnRequestsSigned="false">
    <KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data>
          <X509Certificate>${tenant.certForMetadata}</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
                         Location="${ssoUrlFor(tenant.slug)}"/>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                         Location="${ssoUrlFor(tenant.slug)}"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;
}

// samlify's loginResponseTemplate. Placeholders are substituted in the
// customTagReplacement callback so we can inject misbehaviors there.
const loginResponseTemplate = {
  context: `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="{ID}" Version="2.0" IssueInstant="{IssueInstant}" Destination="{Destination}" InResponseTo="{InResponseTo}"><saml:Issuer>{Issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="{StatusCode}"/></samlp:Status><saml:Assertion ID="{AssertionID}" Version="2.0" IssueInstant="{IssueInstant}" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"><saml:Issuer>{Issuer}</saml:Issuer><saml:Subject><saml:NameID Format="{NameIDFormat}">{NameID}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="{SubjectConfirmationDataNotOnOrAfter}" Recipient="{SubjectRecipient}" InResponseTo="{InResponseTo}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="{ConditionsNotBefore}" NotOnOrAfter="{ConditionsNotOnOrAfter}"><saml:AudienceRestriction><saml:Audience>{Audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AttributeStatement><saml:Attribute Name="email" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic"><saml:AttributeValue xsi:type="xs:string" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xs="http://www.w3.org/2001/XMLSchema">{Email}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="displayName" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic"><saml:AttributeValue xsi:type="xs:string" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xs="http://www.w3.org/2001/XMLSchema">{DisplayName}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement><saml:AuthnStatement AuthnInstant="{IssueInstant}" SessionIndex="{AssertionID}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion></samlp:Response>`,
};

// ---------- tenant init --------------------------------------------------

for (const slug of tenantSlugs) {
  const { privateKeyPem, certPem } = generateSelfSignedCert(`mock-saml-idp-${slug}`);
  const certForMetadata = pemToBase64Cert(certPem);
  const entityId = entityIdFor(slug);

  // Build minimal IdP metadata for samlify's IdentityProvider constructor.
  const metadata = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${certForMetadata}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${ssoUrlFor(slug)}"/>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${ssoUrlFor(slug)}"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;

  const idp = samlify.IdentityProvider({
    metadata,
    privateKey: privateKeyPem,
    isAssertionEncrypted: false,
    loginResponseTemplate,
  });

  tenants.set(slug, {
    slug,
    entityId,
    privateKeyPem,
    certPem,
    certForMetadata,
    idp,
    nextMisbehavior: { kind: 'none' },
    lastResponse: null,
  });
}

// ---------- request parsing ----------------------------------------------

type ParsedRequest = {
  requestId: string,
  issuer: string,           // SP entity ID
  acsUrl: string,           // AssertionConsumerService URL from request
  relayState: string,
};

// Decode an HTTP-Redirect AuthnRequest. samlify can do this but to keep the
// request parsing lib-independent (so a samlify bug here doesn't mask
// backend bugs), we decode the XML ourselves and pull the fields we need.
async function parseAuthnRequestRedirect(samlRequestParam: string, relayState: string): Promise<ParsedRequest> {
  const compressed = Buffer.from(samlRequestParam, 'base64');
  const zlib = await import('zlib');
  const xml = zlib.inflateRawSync(compressed).toString('utf-8');
  return extractRequestFields(xml, relayState);
}

function extractRequestFields(xml: string, relayState: string): ParsedRequest {
  const idMatch = xml.match(/ID="([^"]+)"/);
  const issuerMatch = xml.match(/<(?:saml:)?Issuer[^>]*>([^<]+)<\/(?:saml:)?Issuer>/);
  const acsMatch = xml.match(/AssertionConsumerServiceURL="([^"]+)"/);
  if (!idMatch || !issuerMatch || !acsMatch) {
    throw new Error(`Mock IdP could not parse AuthnRequest (id=${!!idMatch}, issuer=${!!issuerMatch}, acs=${!!acsMatch})`);
  }
  return {
    requestId: idMatch[1],
    issuer: issuerMatch[1],
    acsUrl: acsMatch[1],
    relayState,
  };
}

// ---------- assertion building -------------------------------------------

const ASSERTION_LIFETIME_MS = 5 * 60 * 1000;

function isoNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

type AssertionFields = {
  audience: string,
  inResponseTo: string,
  conditionsNotBefore: string,
  conditionsNotOnOrAfter: string,
};

type AssertionResult = {
  samlResponseB64: string,
  acsUrl: string,
  relayState: string,
};

function consumeNextMisbehavior(tenant: TenantState): Misbehavior {
  const m = tenant.nextMisbehavior;
  tenant.nextMisbehavior = { kind: 'none' };
  return m;
}

function resolveSigningTenant(tenant: TenantState, misbehavior: Misbehavior): TenantState {
  if (misbehavior.kind === 'bad-signature') {
    const other = Array.from(tenants.values()).find(t => t.slug !== tenant.slug);
    if (!other) {
      throw new Error('bad-signature misbehavior requires at least 2 tenants configured');
    }
    return other;
  }
  if (misbehavior.kind === 'sign-with-tenant') {
    const other = tenants.get(misbehavior.tenant);
    if (!other) {
      throw new Error(`sign-with-tenant misbehavior references unknown tenant ${misbehavior.tenant}`);
    }
    return other;
  }
  return tenant;
}

function buildAssertionFields(parsed: ParsedRequest, misbehavior: Misbehavior): AssertionFields {
  return {
    audience: misbehavior.kind === 'wrong-audience'
      ? 'https://wrong.example/audience'
      : parsed.issuer,
    inResponseTo: misbehavior.kind === 'wrong-in-response-to'
      ? `_mock_misbehave_${Math.random().toString(36).slice(2)}`
      : parsed.requestId,
    conditionsNotBefore: misbehavior.kind === 'not-yet-valid'
      ? isoNow(60 * 60 * 1000) // +1 hour
      : isoNow(-30 * 1000),
    conditionsNotOnOrAfter: misbehavior.kind === 'expired'
      ? isoNow(-60 * 1000) // expired 1 minute ago
      : isoNow(ASSERTION_LIFETIME_MS),
  };
}

async function renderLoginResponseXml(
  signingTenant: TenantState,
  issuerEntityId: string,
  parsed: ParsedRequest,
  user: { email: string, displayName: string },
  fields: AssertionFields,
  misbehavior: Misbehavior,
): Promise<string> {
  // Build inline SP — derive from the AuthnRequest to avoid pre-registration.
  const sp = samlify.ServiceProvider({
    entityID: parsed.issuer,
    assertionConsumerService: [{
      Binding: samlify.Constants.namespace.binding.post,
      Location: parsed.acsUrl,
    }],
  });

  const result = await signingTenant.idp.createLoginResponse(
    sp,
    { extract: { request: { id: parsed.requestId } } } as any,
    'post',
    user,
    (template: string) => {
      const id = `_mock_resp_${Math.random().toString(36).slice(2)}`;
      const assertionId = `_mock_assert_${Math.random().toString(36).slice(2)}`;
      const issueInstant = isoNow();

      let context = template
        .replace(/\{ID\}/g, id)
        .replace(/\{AssertionID\}/g, assertionId)
        .replace(/\{IssueInstant\}/g, issueInstant)
        .replace(/\{Destination\}/g, parsed.acsUrl)
        .replace(/\{Issuer\}/g, issuerEntityId)
        .replace(/\{StatusCode\}/g, 'urn:oasis:names:tc:SAML:2.0:status:Success')
        .replace(/\{NameID\}/g, user.email)
        .replace(/\{NameIDFormat\}/g, 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress')
        .replace(/\{SubjectConfirmationDataNotOnOrAfter\}/g, isoNow(ASSERTION_LIFETIME_MS))
        .replace(/\{SubjectRecipient\}/g, parsed.acsUrl)
        .replace(/\{InResponseTo\}/g, fields.inResponseTo)
        .replace(/\{ConditionsNotBefore\}/g, fields.conditionsNotBefore)
        .replace(/\{ConditionsNotOnOrAfter\}/g, fields.conditionsNotOnOrAfter)
        .replace(/\{Audience\}/g, fields.audience)
        .replace(/\{Email\}/g, user.email)
        .replace(/\{DisplayName\}/g, user.displayName);

      if (misbehavior.kind === 'missing-name-id') {
        context = context.replace(/<saml:NameID[^>]*>[^<]*<\/saml:NameID>/, '');
      }
      if (misbehavior.kind === 'missing-email') {
        context = context.replace(
          /<saml:Attribute Name="email"[\s\S]*?<\/saml:Attribute>/,
          '',
        );
      }
      return { id, context };
    },
  );

  return result.context;
}

function cacheReplayableResponse(tenant: TenantState, parsed: ParsedRequest, samlResponseB64: string): void {
  tenant.lastResponse = {
    samlResponseB64,
    relayState: parsed.relayState,
    acsUrl: parsed.acsUrl,
  };
}

async function buildAssertion(
  tenant: TenantState,
  parsed: ParsedRequest,
  user: { email: string, displayName: string },
): Promise<AssertionResult> {
  const misbehavior = consumeNextMisbehavior(tenant);

  // True replay: re-emit the previous response *and* the previous RelayState
  // so the entire POST body matches the cached one. (Returning fresh
  // RelayState here would test "old response + new state", which is a
  // different attack class than replay.)
  if (misbehavior.kind === 'replay') {
    if (!tenant.lastResponse) {
      throw new Error('replay misbehavior requested but no previous response cached for this tenant');
    }
    return {
      samlResponseB64: tenant.lastResponse.samlResponseB64,
      acsUrl: tenant.lastResponse.acsUrl,
      relayState: tenant.lastResponse.relayState,
    };
  }

  const signingTenant = resolveSigningTenant(tenant, misbehavior);
  const fields = buildAssertionFields(parsed, misbehavior);
  const samlResponseB64 = await renderLoginResponseXml(
    signingTenant,
    tenant.entityId,
    parsed,
    user,
    fields,
    misbehavior,
  );

  // Only happy-path responses get cached for replay.
  if (misbehavior.kind === 'none') {
    cacheReplayableResponse(tenant, parsed, samlResponseB64);
  }

  return {
    samlResponseB64,
    acsUrl: parsed.acsUrl,
    relayState: parsed.relayState,
  };
}

// ---------- HTTP server --------------------------------------------------

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const loginFormSource = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Mock SAML IdP — {{tenant}}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #f5f5f7; min-height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 1rem; }
  .card { background: white; padding: 2rem; border-radius: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); width: 100%; max-width: 28rem; }
  h1 { margin: 0 0 0.5rem; font-size: 1.25rem; }
  .tenant { color: #6b7280; font-size: 0.875rem; margin-bottom: 1.5rem; }
  label { display: block; font-size: 0.875rem; margin-bottom: 0.25rem; color: #374151; }
  input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 0.375rem; box-sizing: border-box; font-size: 1rem; }
  button { width: 100%; margin-top: 1rem; padding: 0.625rem; background: #111827; color: white; border: 0; border-radius: 0.375rem; font-weight: 500; cursor: pointer; }
  .hint { color: #9ca3af; font-size: 0.75rem; margin-top: 1rem; }
</style></head><body><div class="card">
  <h1>Mock SAML IdP</h1>
  <div class="tenant">Tenant: <strong>{{tenant}}</strong> · Request ID: <code>{{requestId}}</code></div>
  <form method="post" action="/idp/{{tenant}}/login">
    <input type="hidden" name="SAMLRequest" value="{{samlRequest}}"/>
    <input type="hidden" name="RelayState" value="{{relayState}}"/>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required placeholder="alice@{{tenant}}.test" autofocus/>
    <label for="displayName" style="margin-top: 0.75rem">Display name</label>
    <input id="displayName" name="displayName" type="text" placeholder="Alice"/>
    <button type="submit">Sign in</button>
  </form>
  <div class="hint">No password — this is a test IdP. The submitted email becomes the NameID.</div>
</div></body></html>`;
const loginForm = handlebars.compile(loginFormSource);

const autoPostFormSource = `<!DOCTYPE html>
<html><body onload="document.forms[0].submit()">
<form method="post" action="{{acsUrl}}">
  <input type="hidden" name="SAMLResponse" value="{{samlResponse}}"/>
  <input type="hidden" name="RelayState" value="{{relayState}}"/>
  <noscript><button type="submit">Continue</button></noscript>
</form>
</body></html>`;
const autoPostForm = handlebars.compile(autoPostFormSource);

function getTenant(req: express.Request, res: express.Response): TenantState | null {
  const slug = req.params.tenant;
  const t = tenants.get(slug);
  if (!t) {
    res.status(404).send(`Unknown tenant "${slug}". Configured: ${Array.from(tenants.keys()).join(", ")}`);
    return null;
  }
  return t;
}

// Metadata
app.get('/idp/:tenant/metadata', (req, res) => {
  const t = getTenant(req, res);
  if (!t) return;
  res.type('application/xml').send(buildIdpMetadataXml(t));
});

// SSO endpoint — HTTP-Redirect binding (GET) shows the login form.
app.get('/idp/:tenant/sso', async (req, res) => {
  const t = getTenant(req, res);
  if (!t) return;
  const samlRequest = req.query.SAMLRequest;
  const relayState = (req.query.RelayState as string | undefined) ?? '';
  if (typeof samlRequest !== 'string') {
    res.status(400).send('Missing SAMLRequest query parameter');
    return;
  }
  try {
    const parsed = await parseAuthnRequestRedirect(samlRequest, relayState);
    res.send(loginForm({
      tenant: t.slug,
      requestId: parsed.requestId,
      samlRequest,
      relayState,
    }));
  } catch (err: any) {
    res.status(400).send(`Mock IdP failed to parse AuthnRequest: ${err.message}`);
  }
});

// Login form submission — builds the assertion and auto-POSTs to ACS.
app.post('/idp/:tenant/login', async (req, res) => {
  const t = getTenant(req, res);
  if (!t) return;
  const email = String(req.body.email ?? '').trim();
  const displayName = String(req.body.displayName ?? email.split('@')[0] ?? 'Mock User').trim();
  const samlRequest = String(req.body.SAMLRequest ?? '');
  const relayState = String(req.body.RelayState ?? '');
  if (!email || !samlRequest) {
    res.status(400).send('Missing email or SAMLRequest');
    return;
  }
  try {
    const parsed = await parseAuthnRequestRedirect(samlRequest, relayState);
    const { samlResponseB64, acsUrl, relayState: outRelayState } = await buildAssertion(t, parsed, { email, displayName });
    res.send(autoPostForm({ acsUrl, samlResponse: samlResponseB64, relayState: outRelayState }));
  } catch (err: any) {
    res.status(500).send(`Mock IdP failed to build assertion: ${err.message}`);
  }
});

// Test-controls — set the next assertion to misbehave in a specific way.
// E2E tests call this BEFORE driving the login flow.
app.post('/idp/:tenant/test-controls', (req, res) => {
  const t = getTenant(req, res);
  if (!t) return;
  const body = req.body as { kind?: unknown };
  if (typeof body.kind !== 'string') {
    res.status(400).json({ error: 'body must be a Misbehavior object with `kind`' });
    return;
  }
  t.nextMisbehavior = body as Misbehavior;
  res.json({ ok: true, queued: body });
});

// Health + introspection
app.get('/idp', (req, res) => {
  res.json({
    tenants: Array.from(tenants.values()).map(t => ({
      slug: t.slug,
      entityId: t.entityId,
      metadataUrl: `http://localhost:${port}/idp/${t.slug}/metadata`,
      ssoUrl: ssoUrlFor(t.slug),
      nextMisbehavior: t.nextMisbehavior,
    })),
  });
});

app.listen(port, () => {
  console.log(`Mock SAML IdP listening on http://localhost:${port}`);
  console.log(`  tenants: ${Array.from(tenants.keys()).join(", ")}`);
  for (const t of Array.from(tenants.values())) {
    console.log(`  /idp/${t.slug}/metadata`);
  }
});
