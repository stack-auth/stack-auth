import { createMcpAuthAdapter, InvalidMcpAccessTokenError, type McpAuthAdapter } from '@hexclave/js';
import crypto from "node:crypto";
import { describe } from "vitest";
import { it } from "../helpers";
import { createApp } from "./js-helpers";

const RESOURCE_URL = "https://mcp-test.example.com/mcp";
const OAUTH_BASE = "https://mcp-test.example.com/api/mcp-oauth";

function unescapeHtml(escaped: string): string {
  return escaped
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&amp;", "&");
}

function parseHiddenInputs(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of html.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)">/g)) {
    result[unescapeHtml(match[1])] = unescapeHtml(match[2]);
  }
  return result;
}

function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function setUpAdapter() {
  const { serverApp } = await createApp({
    config: {
      credentialEnabled: true,
    },
  });
  await serverApp.signUpWithCredential({
    email: "mcp-test@example.com",
    password: "password123",
    verificationCallbackUrl: "http://localhost:3000",
  });
  const user = await serverApp.getUser({ or: "throw" });
  const adapter = createMcpAuthAdapter({
    app: serverApp,
    resourceUrl: RESOURCE_URL,
    scopesSupported: ["mcp:tools"],
  });
  return { serverApp, user, adapter };
}

async function registerClient(adapter: McpAuthAdapter, redirectUri: string): Promise<string> {
  const response = await adapter.handler(new Request(`${OAUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "Test MCP Client" }),
  }));
  if (response.status !== 201) throw new Error(`Registration failed: ${await response.text()}`);
  const body = await response.json();
  return body.client_id;
}

async function authorizeAndGetCode(adapter: McpAuthAdapter, options: { clientId: string, redirectUri: string, challenge: string, state?: string, deny?: boolean }): Promise<URL> {
  const authorizeUrl = new URL(`${OAUTH_BASE}/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", options.clientId);
  authorizeUrl.searchParams.set("redirect_uri", options.redirectUri);
  authorizeUrl.searchParams.set("code_challenge", options.challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", "mcp:tools");
  if (options.state !== undefined) authorizeUrl.searchParams.set("state", options.state);

  const consentResponse = await adapter.handler(new Request(authorizeUrl.toString()));
  if (consentResponse.status !== 200) throw new Error(`Authorize failed: ${await consentResponse.text()}`);
  const hiddenInputs = parseHiddenInputs(await consentResponse.text());

  const form = new URLSearchParams(hiddenInputs);
  form.set("action", options.deny ? "deny" : "approve");
  const approveResponse = await adapter.handler(new Request(authorizeUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  }));
  if (approveResponse.status !== 302) throw new Error(`Consent submission failed: ${await approveResponse.text()}`);
  return new URL(approveResponse.headers.get("location") ?? throwMissingLocation());
}

function throwMissingLocation(): never {
  throw new Error("Redirect response has no location header");
}

async function exchangeCode(adapter: McpAuthAdapter, options: { code: string, verifier: string, clientId: string, redirectUri: string }): Promise<Response> {
  return await adapter.handler(new Request(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: options.code,
      code_verifier: options.verifier,
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
    }).toString(),
  }));
}

describe("MCP auth adapter", () => {
  it("serves OAuth metadata endpoints", async ({ expect }) => {
    const { adapter } = await setUpAdapter();

    const asMetadataResponse = await adapter.handler(new Request("https://mcp-test.example.com/.well-known/oauth-authorization-server"));
    expect(asMetadataResponse.status).toBe(200);
    const asMetadata = await asMetadataResponse.json();
    expect(asMetadata.issuer).toBe(OAUTH_BASE);
    expect(asMetadata.authorization_endpoint).toBe(`${OAUTH_BASE}/authorize`);
    expect(asMetadata.token_endpoint).toBe(`${OAUTH_BASE}/token`);
    expect(asMetadata.registration_endpoint).toBe(`${OAUTH_BASE}/register`);
    expect(asMetadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(asMetadata.scopes_supported).toEqual(["mcp:tools"]);

    const prmResponse = await adapter.handler(new Request("https://mcp-test.example.com/.well-known/oauth-protected-resource/mcp"));
    expect(prmResponse.status).toBe(200);
    const prm = await prmResponse.json();
    expect(prm.resource).toBe(RESOURCE_URL);
    expect(prm.authorization_servers).toEqual([OAUTH_BASE]);
  });

  it("completes the full authorization code flow with PKCE, token refresh, and bearer auth", async ({ expect }) => {
    const { adapter, user } = await setUpAdapter();
    const redirectUri = "https://client.example.com/callback";
    const clientId = await registerClient(adapter, redirectUri);
    const { verifier, challenge } = createPkcePair();

    const callbackUrl = await authorizeAndGetCode(adapter, { clientId, redirectUri, challenge, state: "some-state" });
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(redirectUri);
    expect(callbackUrl.searchParams.get("state")).toBe("some-state");
    const code = callbackUrl.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenResponse = await exchangeCode(adapter, { code: code!, verifier, clientId, redirectUri });
    expect(tokenResponse.status).toBe(200);
    const tokens = await tokenResponse.json();
    expect(tokens.token_type).toBe("bearer");
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.expires_in).toBeGreaterThan(0);
    expect(tokens.scope).toBe("mcp:tools");

    const authInfo = await adapter.verifyAccessToken(tokens.access_token);
    expect(authInfo.extra?.userId).toBe(user.id);
    expect(authInfo.scopes).toEqual(["mcp:tools"]);

    const refreshResponse = await adapter.handler(new Request(`${OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }).toString(),
    }));
    expect(refreshResponse.status).toBe(200);
    const refreshed = await refreshResponse.json();
    expect(refreshed.access_token).toBeTruthy();
    const refreshedAuthInfo = await adapter.verifyAccessToken(refreshed.access_token);
    expect(refreshedAuthInfo.extra?.userId).toBe(user.id);

    const protectedHandler = adapter.withMcpAuth(async (_req, auth) => {
      const authedUser = await auth.getUser();
      return new Response(JSON.stringify({ userId: authedUser.id }), { status: 200 });
    });

    const unauthorizedResponse = await protectedHandler(new Request(RESOURCE_URL, { method: "POST" }));
    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedResponse.headers.get("www-authenticate")).toContain("resource_metadata=");

    const authorizedResponse = await protectedHandler(new Request(RESOURCE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }));
    expect(authorizedResponse.status).toBe(200);
    expect((await authorizedResponse.json()).userId).toBe(user.id);
  });

  it("rejects token exchange with an incorrect PKCE verifier or redirect URI", async ({ expect }) => {
    const { adapter } = await setUpAdapter();
    const redirectUri = "https://client.example.com/callback";
    const clientId = await registerClient(adapter, redirectUri);
    const { challenge } = createPkcePair();

    const callbackUrl = await authorizeAndGetCode(adapter, { clientId, redirectUri, challenge });
    const code = callbackUrl.searchParams.get("code")!;

    const wrongVerifierResponse = await exchangeCode(adapter, { code, verifier: "wrong-verifier-wrong-verifier-wrong-verifier", clientId, redirectUri });
    expect(wrongVerifierResponse.status).toBe(400);
    expect((await wrongVerifierResponse.json()).error).toBe("invalid_grant");

    const wrongRedirectResponse = await exchangeCode(adapter, { code, verifier: "irrelevant-because-redirect-is-checked-first", clientId, redirectUri: "https://client.example.com/other" });
    expect(wrongRedirectResponse.status).toBe(400);
    expect((await wrongRedirectResponse.json()).error).toBe("invalid_grant");
  });

  it("redirects with access_denied when the user denies consent", async ({ expect }) => {
    const { adapter } = await setUpAdapter();
    const redirectUri = "https://client.example.com/callback";
    const clientId = await registerClient(adapter, redirectUri);
    const { challenge } = createPkcePair();

    const callbackUrl = await authorizeAndGetCode(adapter, { clientId, redirectUri, challenge, state: "deny-state", deny: true });
    expect(callbackUrl.searchParams.get("error")).toBe("access_denied");
    expect(callbackUrl.searchParams.get("state")).toBe("deny-state");
    expect(callbackUrl.searchParams.get("code")).toBeNull();
  });

  it("redirects signed-out users to the sign-in page", async ({ expect }) => {
    const { serverApp } = await setUpAdapter();
    await serverApp.signOut();
    const adapter = createMcpAuthAdapter({ app: serverApp, resourceUrl: RESOURCE_URL });
    const redirectUri = "https://client.example.com/callback";
    const clientId = await registerClient(adapter, redirectUri);
    const { challenge } = createPkcePair();

    const authorizeUrl = new URL(`${OAUTH_BASE}/authorize`);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    const response = await adapter.handler(new Request(authorizeUrl.toString()));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? throwMissingLocation());
    expect(location.pathname).toContain("sign-in");
    expect(location.searchParams.get("after_auth_return_to")).toContain("/authorize");
  });

  it("rejects authorization requests with unknown clients or unregistered redirect URIs", async ({ expect }) => {
    const { adapter } = await setUpAdapter();
    const redirectUri = "https://client.example.com/callback";
    const clientId = await registerClient(adapter, redirectUri);

    const unknownClientUrl = new URL(`${OAUTH_BASE}/authorize`);
    unknownClientUrl.searchParams.set("response_type", "code");
    unknownClientUrl.searchParams.set("client_id", "not-a-real-client-id");
    unknownClientUrl.searchParams.set("redirect_uri", redirectUri);
    unknownClientUrl.searchParams.set("code_challenge", "abc");
    unknownClientUrl.searchParams.set("code_challenge_method", "S256");
    const unknownClientResponse = await adapter.handler(new Request(unknownClientUrl.toString()));
    expect(unknownClientResponse.status).toBe(400);

    const wrongRedirectUrl = new URL(`${OAUTH_BASE}/authorize`);
    wrongRedirectUrl.searchParams.set("response_type", "code");
    wrongRedirectUrl.searchParams.set("client_id", clientId);
    wrongRedirectUrl.searchParams.set("redirect_uri", "https://attacker.example.com/callback");
    wrongRedirectUrl.searchParams.set("code_challenge", "abc");
    wrongRedirectUrl.searchParams.set("code_challenge_method", "S256");
    const wrongRedirectResponse = await adapter.handler(new Request(wrongRedirectUrl.toString()));
    expect(wrongRedirectResponse.status).toBe(400);
  });

  it("rejects registration with invalid redirect URIs", async ({ expect }) => {
    const { adapter } = await setUpAdapter();
    for (const redirectUri of ["not-a-url", "javascript:alert(1)", "http://public.example.com/callback"]) {
      const response = await adapter.handler(new Request(`${OAUTH_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [redirectUri] }),
      }));
      expect(response.status).toBe(400);
    }
  });

  it("throws InvalidMcpAccessTokenError for invalid bearer tokens", async ({ expect }) => {
    const { adapter } = await setUpAdapter();
    await expect(adapter.verifyAccessToken("not-a-valid-token")).rejects.toThrow(InvalidMcpAccessTokenError);
  });
});
