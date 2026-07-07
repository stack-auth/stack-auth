import { HexclaveServerInterface } from "@hexclave/shared/dist/interface/server-interface";
import { AccessToken, RefreshToken } from "@hexclave/shared/dist/sessions";
import { encodeBase64Url } from "@hexclave/shared/dist/utils/bytes";
import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { globalVar } from "@hexclave/shared/dist/utils/globals";
import { escapeHtml } from "@hexclave/shared/dist/utils/html";
import { deindent } from "@hexclave/shared/dist/utils/strings";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import * as jose from "jose";
import { JOSEError } from "jose/errors";
import { StackServerApp } from "../lib/hexclave-app/apps/interfaces/server-app";
import { ServerUser } from "../lib/hexclave-app/users";

/**
 * Structurally compatible with the `AuthInfo` type of the `@modelcontextprotocol/sdk` package, so the return value of
 * `verifyAccessToken` can be passed anywhere the MCP SDK expects an `AuthInfo` (eg. `requireBearerAuth`), without
 * this package having to depend on the MCP SDK.
 */
export type McpAuthInfo = {
  token: string,
  clientId: string,
  scopes: string[],
  expiresAt?: number,
  resource?: URL,
  extra?: Record<string, unknown>,
};

export type McpAuthAdapterOptions = {
  /**
   * The Hexclave server app of the project whose users should be able to authenticate with the MCP server.
   */
  app: StackServerApp<boolean, string>,
  /**
   * The full, public URL of the MCP endpoint that is being protected, eg. `https://example.com/mcp`.
   */
  resourceUrl: string | URL,
  /**
   * The path prefix (on the same origin as `resourceUrl`) where the adapter's OAuth endpoints are mounted.
   *
   * @default "/api/mcp-oauth"
   */
  oauthBasePath?: string,
  /**
   * The OAuth scopes that this MCP server supports. Note that Hexclave access tokens are not scoped; the granted
   * scopes are returned verbatim in the token response and in `McpAuthInfo.scopes` so the MCP server can do its own
   * scope checks.
   */
  scopesSupported?: string[],
  /**
   * How long the session created for an MCP client should be valid (this is the lifetime of the refresh token, not
   * the access token).
   *
   * @default 30 days
   */
  sessionExpiresInMillis?: number,
};

export type McpAuthAdapter = {
  /**
   * A fetch-style handler (`Request => Response`) for all OAuth endpoints of the adapter. Mount it (eg. as Next.js
   * route handlers) such that it receives requests for:
   *
   * - `/.well-known/oauth-authorization-server` (and subpaths)
   * - `/.well-known/oauth-protected-resource` (and subpaths)
   * - `${oauthBasePath}/register|authorize|token`
   */
  handler: (req: Request) => Promise<Response>,
  /**
   * Verifies a bearer token sent by an MCP client. Throws `InvalidMcpAccessTokenError` if the token is invalid, so
   * it can be used directly as the MCP SDK's `OAuthTokenVerifier.verifyAccessToken`.
   */
  verifyAccessToken: (token: string) => Promise<McpAuthInfo>,
  /**
   * Wraps a fetch-style MCP request handler with bearer authentication. Responds with 401 + `WWW-Authenticate`
   * (pointing MCP clients at the protected resource metadata) when the token is missing or invalid.
   */
  withMcpAuth: (
    handler: (req: Request, auth: { authInfo: McpAuthInfo, getUser: () => Promise<ServerUser> }) => Promise<Response>,
  ) => (req: Request) => Promise<Response>,
};

export class InvalidMcpAccessTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMcpAccessTokenError";
  }
}

const DEFAULT_OAUTH_BASE_PATH = "/api/mcp-oauth";
const DEFAULT_SESSION_EXPIRES_IN_MILLIS = 1000 * 60 * 60 * 24 * 30;
const AUTHORIZATION_CODE_EXPIRATION = "2m";
const CONSENT_INTERACTION_EXPIRATION = "15m";

type TokenUse = "client" | "interaction" | "code";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function oauthErrorResponse(status: number, error: string, description: string): Response {
  return jsonResponse(status, { error, error_description: description });
}

function htmlResponse(status: number, html: string): Response {
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function isAllowedRedirectUri(uri: string): boolean {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  // plain HTTP is only allowed for loopback redirect URIs (native clients, RFC 8252 §7.3)
  if (url.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // custom schemes (eg. `cursor://...`) are used by native MCP clients
  return url.protocol !== "javascript:" && url.protocol !== "data:" && url.protocol !== "file:";
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await globalVar.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return encodeBase64Url(new Uint8Array(digest));
}

export function createMcpAuthAdapter(options: McpAuthAdapterOptions): McpAuthAdapter {
  const app = options.app;
  // The interface (and thereby the secret server key, which we derive the adapter's stateless signing key from) is
  // not part of the public StackServerApp type, so grab it off the implementation. The instanceof check validates
  // the cast at runtime.
  const iface = (app as unknown as { _interface: unknown })._interface;
  if (!(iface instanceof HexclaveServerInterface)) {
    throw new HexclaveAssertionError("createMcpAuthAdapter: expected a StackServerApp instance");
  }
  const ifaceOptions = iface.options;
  if (!("secretServerKey" in ifaceOptions)) {
    throw new HexclaveAssertionError("createMcpAuthAdapter: the app passed to the MCP auth adapter must be constructed with a secretServerKey");
  }
  const secretServerKey = ifaceOptions.secretServerKey;
  const projectId = ifaceOptions.projectId;
  const apiBaseUrl = ifaceOptions.getBaseUrl();

  const resourceUrl = new URL(options.resourceUrl);
  const oauthBasePath = options.oauthBasePath ?? DEFAULT_OAUTH_BASE_PATH;
  if (!oauthBasePath.startsWith("/") || oauthBasePath.endsWith("/")) {
    throw new HexclaveAssertionError("createMcpAuthAdapter: oauthBasePath must start with (but not end with) a slash", { oauthBasePath });
  }
  const scopesSupported = options.scopesSupported ?? [];
  const sessionExpiresInMillis = options.sessionExpiresInMillis ?? DEFAULT_SESSION_EXPIRES_IN_MILLIS;

  const issuer = new URL(oauthBasePath, resourceUrl.origin).toString();

  let signingKeyPromise: Promise<Uint8Array> | null = null;
  const getSigningKey = () => {
    // The adapter is fully stateless: dynamic client registrations, consent interactions, and authorization codes
    // are all HS256 JWTs signed with a key derived from the project's secret server key.
    if (signingKeyPromise == null) {
      signingKeyPromise = (async () => {
        const digest: ArrayBuffer = await globalVar.crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(["hexclave-mcp-oauth-signing-key", secretServerKey])),
        );
        return new Uint8Array(digest);
      })();
    }
    return signingKeyPromise;
  };

  const signToken = async (tokenUse: TokenUse, payload: Record<string, unknown>, expirationTime?: string) => {
    let jwt = new jose.SignJWT({ ...payload, token_use: tokenUse })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer(issuer);
    if (expirationTime !== undefined) {
      jwt = jwt.setExpirationTime(expirationTime);
    }
    return await jwt.sign(await getSigningKey());
  };

  const verifySignedToken = async (tokenUse: TokenUse, token: string): Promise<jose.JWTPayload | null> => {
    try {
      const { payload } = await jose.jwtVerify(token, await getSigningKey(), { issuer });
      if (payload.token_use !== tokenUse) return null;
      return payload;
    } catch (e) {
      if (e instanceof JOSEError) return null;
      throw e;
    }
  };

  type RegisteredClient = { redirectUris: string[], clientName: string | null };

  const parseClientId = async (clientId: string): Promise<RegisteredClient | null> => {
    const payload = await verifySignedToken("client", clientId);
    if (!payload) return null;
    const redirectUris = payload.redirect_uris;
    if (!Array.isArray(redirectUris) || !redirectUris.every((u) => typeof u === "string")) return null;
    return {
      redirectUris,
      clientName: typeof payload.client_name === "string" ? payload.client_name : null,
    };
  };

  const handleAuthorizationServerMetadata = () => {
    return jsonResponse(200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      ...scopesSupported.length > 0 ? { scopes_supported: scopesSupported } : {},
    });
  };

  const handleProtectedResourceMetadata = () => {
    return jsonResponse(200, {
      resource: resourceUrl.toString(),
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
      ...scopesSupported.length > 0 ? { scopes_supported: scopesSupported } : {},
    });
  };

  const handleRegister = async (req: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return oauthErrorResponse(400, "invalid_client_metadata", "Request body is not valid JSON.");
    }
    if (typeof body !== "object" || body === null) {
      return oauthErrorResponse(400, "invalid_client_metadata", "Request body must be a JSON object.");
    }
    const bodyObject = body as Record<string, unknown>;
    const redirectUris = bodyObject.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((u) => typeof u === "string")) {
      return oauthErrorResponse(400, "invalid_redirect_uri", "redirect_uris must be a non-empty array of strings.");
    }
    for (const uri of redirectUris) {
      if (!isAllowedRedirectUri(uri)) {
        return oauthErrorResponse(400, "invalid_redirect_uri", `Invalid redirect URI: ${uri}`);
      }
    }
    const clientName = typeof bodyObject.client_name === "string" ? bodyObject.client_name : undefined;

    const clientId = await signToken("client", {
      redirect_uris: redirectUris,
      ...clientName !== undefined ? { client_name: clientName } : {},
    });

    return jsonResponse(201, {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...clientName !== undefined ? { client_name: clientName } : {},
    });
  };

  type AuthorizeParams = {
    clientId: string,
    client: RegisteredClient,
    redirectUri: string,
    codeChallenge: string,
    state: string | null,
    scope: string | null,
    resource: string | null,
  };

  const parseAndValidateAuthorizeParams = async (params: URLSearchParams): Promise<{ ok: true, value: AuthorizeParams } | { ok: false, response: Response } | { ok: false, redirectError: { redirectUri: string, state: string | null, error: string, description: string } }> => {
    const clientId = params.get("client_id");
    const redirectUri = params.get("redirect_uri");
    // per OAuth 2.1, errors in client_id/redirect_uri must NOT redirect to the redirect URI
    if (clientId == null || redirectUri == null) {
      return { ok: false, response: htmlResponse(400, renderErrorPage("Missing client_id or redirect_uri parameter.")) };
    }
    const client = await parseClientId(clientId);
    if (client == null) {
      return { ok: false, response: htmlResponse(400, renderErrorPage("Unknown client_id. Register the client first at the registration endpoint.")) };
    }
    if (!client.redirectUris.includes(redirectUri)) {
      return { ok: false, response: htmlResponse(400, renderErrorPage("The given redirect_uri is not registered for this client.")) };
    }
    const state = params.get("state");
    if (params.get("response_type") !== "code") {
      return { ok: false, redirectError: { redirectUri, state, error: "unsupported_response_type", description: "Only response_type=code is supported." } };
    }
    const codeChallenge = params.get("code_challenge");
    if (codeChallenge == null || params.get("code_challenge_method") !== "S256") {
      return { ok: false, redirectError: { redirectUri, state, error: "invalid_request", description: "PKCE with code_challenge_method=S256 is required." } };
    }
    return {
      ok: true,
      value: {
        clientId,
        client,
        redirectUri,
        codeChallenge,
        state,
        scope: params.get("scope"),
        resource: params.get("resource"),
      },
    };
  };

  const redirectWithError = (redirectUri: string, state: string | null, error: string, description: string): Response => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (state != null) url.searchParams.set("state", state);
    return Response.redirect(url.toString(), 302);
  };

  const renderErrorPage = (message: string) => deindent`
    <!DOCTYPE html>
    <html>
      <head><title>Authorization error</title></head>
      <body>
        <h1>Authorization error</h1>
        <p>${escapeHtml(message)}</p>
      </body>
    </html>
  `;

  const renderConsentPage = (reqUrl: URL, params: AuthorizeParams, interactionToken: string, userDisplay: string) => {
    const clientDisplay = params.client.clientName ?? new URL(params.redirectUri).host;
    const hiddenFields = [
      ...reqUrl.searchParams.entries(),
      ["interaction_token", interactionToken],
    ].map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join("\n");
    return deindent`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authorize ${escapeHtml(clientDisplay)}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f4f4f5; }
            .card { background: white; border-radius: 12px; padding: 32px; max-width: 400px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
            .buttons { display: flex; gap: 12px; margin-top: 24px; }
            button { flex: 1; padding: 10px; border-radius: 8px; border: 1px solid #d4d4d8; background: white; cursor: pointer; font-size: 14px; }
            button.approve { background: #18181b; color: white; border-color: #18181b; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Authorization request</h1>
            <p><strong>${escapeHtml(clientDisplay)}</strong> wants to access your account (${escapeHtml(userDisplay)}).</p>
            ${params.scope != null ? `<p>Requested scopes: <code>${escapeHtml(params.scope)}</code></p>` : ""}
            <form method="POST">
              ${hiddenFields}
              <div class="buttons">
                <button type="submit" name="action" value="deny">Deny</button>
                <button type="submit" name="action" value="approve" class="approve">Approve</button>
              </div>
            </form>
          </div>
        </body>
      </html>
    `;
  };

  const getCurrentUser = async () => {
    // uses the token store the app was constructed with (eg. "nextjs-cookie"), which contains the session of the
    // user currently signed in to the customer's app on this origin
    return await app.getUser({ or: "return-null" });
  };

  const handleAuthorizeGet = async (req: Request): Promise<Response> => {
    const reqUrl = new URL(req.url);
    const parsed = await parseAndValidateAuthorizeParams(reqUrl.searchParams);
    if (!parsed.ok) {
      return "response" in parsed ? parsed.response : redirectWithError(parsed.redirectError.redirectUri, parsed.redirectError.state, parsed.redirectError.error, parsed.redirectError.description);
    }
    const params = parsed.value;

    const user = await getCurrentUser();
    if (user == null) {
      // reuse the app's existing sign-in page; it redirects back to this authorize URL after authentication
      const signInUrl = new URL(app.urls.signIn, reqUrl);
      signInUrl.searchParams.set("after_auth_return_to", reqUrl.pathname + reqUrl.search);
      return Response.redirect(signInUrl.toString(), 302);
    }

    const interactionToken = await signToken("interaction", {
      sub: user.id,
      authorize_params_hash: await sha256Base64Url(reqUrl.searchParams.toString()),
    }, CONSENT_INTERACTION_EXPIRATION);

    return htmlResponse(200, renderConsentPage(reqUrl, params, interactionToken, user.primaryEmail ?? user.displayName ?? user.id));
  };

  const handleAuthorizePost = async (req: Request): Promise<Response> => {
    const formData = await req.formData();
    const formParams = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string" && key !== "interaction_token" && key !== "action") {
        formParams.append(key, value);
      }
    }

    const parsed = await parseAndValidateAuthorizeParams(formParams);
    if (!parsed.ok) {
      return "response" in parsed ? parsed.response : redirectWithError(parsed.redirectError.redirectUri, parsed.redirectError.state, parsed.redirectError.error, parsed.redirectError.description);
    }
    const params = parsed.value;

    const action = formData.get("action");
    if (action !== "approve") {
      return redirectWithError(params.redirectUri, params.state, "access_denied", "The user denied the authorization request.");
    }

    const interactionTokenValue = formData.get("interaction_token");
    const interaction = typeof interactionTokenValue === "string" ? await verifySignedToken("interaction", interactionTokenValue) : null;
    if (interaction == null || interaction.authorize_params_hash !== await sha256Base64Url(formParams.toString())) {
      return htmlResponse(400, renderErrorPage("Invalid or expired authorization interaction. Please try again."));
    }

    const user = await getCurrentUser();
    if (user == null || user.id !== interaction.sub) {
      return htmlResponse(400, renderErrorPage("Your session has changed since the authorization request was started. Please try again."));
    }

    const code = await signToken("code", {
      sub: user.id,
      client_id_hash: await sha256Base64Url(params.clientId),
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      ...params.scope != null ? { scope: params.scope } : {},
      ...params.resource != null ? { resource: params.resource } : {},
    }, AUTHORIZATION_CODE_EXPIRATION);

    const url = new URL(params.redirectUri);
    url.searchParams.set("code", code);
    if (params.state != null) url.searchParams.set("state", params.state);
    return Response.redirect(url.toString(), 302);
  };

  const handleToken = async (req: Request): Promise<Response> => {
    let form: URLSearchParams;
    try {
      form = new URLSearchParams(await req.text());
    } catch {
      return oauthErrorResponse(400, "invalid_request", "Request body must be application/x-www-form-urlencoded.");
    }
    const grantType = form.get("grant_type");
    switch (grantType) {
      case "authorization_code": {
        const code = form.get("code");
        const codeVerifier = form.get("code_verifier");
        const clientId = form.get("client_id");
        const redirectUri = form.get("redirect_uri");
        if (code == null || codeVerifier == null || clientId == null || redirectUri == null) {
          return oauthErrorResponse(400, "invalid_request", "code, code_verifier, client_id, and redirect_uri are required.");
        }
        const payload = await verifySignedToken("code", code);
        if (payload == null) {
          return oauthErrorResponse(400, "invalid_grant", "Invalid or expired authorization code.");
        }
        if (payload.client_id_hash !== await sha256Base64Url(clientId)) {
          return oauthErrorResponse(400, "invalid_grant", "The authorization code was issued to a different client.");
        }
        if (payload.redirect_uri !== redirectUri) {
          return oauthErrorResponse(400, "invalid_grant", "redirect_uri does not match the one used in the authorization request.");
        }
        if (payload.code_challenge !== await sha256Base64Url(codeVerifier)) {
          return oauthErrorResponse(400, "invalid_grant", "PKCE verification failed.");
        }
        const userId = payload.sub ?? throwErr("Authorization code has no sub; this should never happen because we always set it when signing");
        const user = await app.getUser(userId);
        if (user == null) {
          return oauthErrorResponse(400, "invalid_grant", "The user this authorization code was issued for no longer exists.");
        }
        const session = await user.createSession({ expiresInMillis: sessionExpiresInMillis });
        const tokens = await session.getTokens();
        if (tokens.accessToken == null || tokens.refreshToken == null) {
          throw new HexclaveAssertionError("createSession did not return tokens; this should never happen for non-impersonation sessions");
        }
        const accessToken = AccessToken.createIfValid(tokens.accessToken) ?? throwErr("Backend returned an invalid access token");
        return jsonResponse(200, {
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          token_type: "bearer",
          expires_in: Math.max(0, Math.floor((accessToken.expiresAt.getTime() - Date.now()) / 1000)),
          ...typeof payload.scope === "string" ? { scope: payload.scope } : {},
        });
      }
      case "refresh_token": {
        const refreshTokenValue = form.get("refresh_token");
        if (refreshTokenValue == null) {
          return oauthErrorResponse(400, "invalid_request", "refresh_token is required.");
        }
        const accessToken = await iface.fetchNewAccessToken(new RefreshToken(refreshTokenValue));
        if (accessToken == null) {
          return oauthErrorResponse(400, "invalid_grant", "Invalid or expired refresh token.");
        }
        return jsonResponse(200, {
          access_token: accessToken.token,
          refresh_token: refreshTokenValue,
          token_type: "bearer",
          expires_in: Math.max(0, Math.floor((accessToken.expiresAt.getTime() - Date.now()) / 1000)),
        });
      }
      default: {
        return oauthErrorResponse(400, "unsupported_grant_type", `Unsupported grant_type: ${grantType ?? "<missing>"}`);
      }
    }
  };

  let remoteJwkSet: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
  const getRemoteJwkSet = () => {
    remoteJwkSet ??= jose.createRemoteJWKSet(new URL(urlString`/api/v1/projects/${projectId}/.well-known/jwks.json`, apiBaseUrl));
    return remoteJwkSet;
  };

  const verifyAccessToken = async (token: string): Promise<McpAuthInfo> => {
    let payload: jose.JWTPayload;
    try {
      // Hexclave access tokens are ES256 JWTs signed with the project's JWKS; the audience of non-anonymous,
      // non-restricted user tokens is exactly the project ID (anonymous/restricted tokens have a different audience
      // and are therefore rejected here).
      const verified = await jose.jwtVerify(token, getRemoteJwkSet(), { audience: projectId });
      payload = verified.payload;
    } catch (e) {
      if (e instanceof JOSEError) {
        throw new InvalidMcpAccessTokenError("Invalid or expired access token.");
      }
      throw e;
    }
    const userId = payload.sub ?? throwErr("Verified access token has no sub claim; this should never happen because the backend always sets it");
    return {
      token,
      // Hexclave access tokens are regular session tokens and don't carry the (stateless) MCP OAuth client ID, so we
      // can't recover which dynamically registered client the token was issued to.
      clientId: "hexclave-mcp-oauth-client",
      scopes: scopesSupported,
      ...payload.exp !== undefined ? { expiresAt: payload.exp } : {},
      extra: { userId },
    };
  };

  const protectedResourceMetadataUrl = new URL(
    `/.well-known/oauth-protected-resource${resourceUrl.pathname === "/" ? "" : resourceUrl.pathname}`,
    resourceUrl.origin,
  ).toString();

  const withMcpAuth: McpAuthAdapter["withMcpAuth"] = (handler) => {
    return async (req: Request) => {
      const unauthorized = (description: string) => new Response(JSON.stringify({ error: "invalid_token", error_description: description }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer error="invalid_token", error_description="${description}", resource_metadata="${protectedResourceMetadataUrl}"`,
          ...corsHeaders,
        },
      });

      const authorization = req.headers.get("authorization");
      if (authorization == null || !authorization.toLowerCase().startsWith("bearer ")) {
        return unauthorized("Missing bearer token.");
      }
      let authInfo: McpAuthInfo;
      try {
        authInfo = await verifyAccessToken(authorization.slice("bearer ".length));
      } catch (e) {
        if (e instanceof InvalidMcpAccessTokenError) {
          return unauthorized("Invalid or expired access token.");
        }
        throw e;
      }
      return await handler(req, {
        authInfo,
        getUser: async () => {
          const userId = authInfo.extra?.userId;
          if (typeof userId !== "string") throw new HexclaveAssertionError("authInfo.extra.userId is not a string; this should never happen because verifyAccessToken always sets it");
          return await app.getUser(userId) ?? throwErr("The user of a verified access token no longer exists");
        },
      });
    };
  };

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (pathname === "/.well-known/oauth-authorization-server" || pathname.startsWith("/.well-known/oauth-authorization-server/")) {
      if (req.method !== "GET") return oauthErrorResponse(405, "invalid_request", "Method not allowed.");
      return handleAuthorizationServerMetadata();
    }
    if (pathname === "/.well-known/oauth-protected-resource" || pathname.startsWith("/.well-known/oauth-protected-resource/")) {
      if (req.method !== "GET") return oauthErrorResponse(405, "invalid_request", "Method not allowed.");
      return handleProtectedResourceMetadata();
    }
    switch (pathname) {
      case `${oauthBasePath}/register`: {
        if (req.method !== "POST") return oauthErrorResponse(405, "invalid_request", "Method not allowed.");
        return await handleRegister(req);
      }
      case `${oauthBasePath}/authorize`: {
        if (req.method === "GET") return await handleAuthorizeGet(req);
        if (req.method === "POST") return await handleAuthorizePost(req);
        return oauthErrorResponse(405, "invalid_request", "Method not allowed.");
      }
      case `${oauthBasePath}/token`: {
        if (req.method !== "POST") return oauthErrorResponse(405, "invalid_request", "Method not allowed.");
        return await handleToken(req);
      }
      default: {
        return jsonResponse(404, { error: "not_found", error_description: `Unknown MCP OAuth endpoint: ${pathname}` });
      }
    }
  };

  return {
    handler,
    verifyAccessToken,
    withMcpAuth,
  };
}
