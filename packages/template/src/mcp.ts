import * as jose from "jose";

/**
 * Hexclave for MCP servers.
 *
 * The design constraint here is that we ship a **verifier**, not a framework wrapper. The MCP
 * TypeScript ecosystem has converged on one extension seam, and every framework exposes the same
 * shape:
 *
 *  - `mcp-handler` / `@vercel/mcp-adapter`: `withMcpAuth(handler, verifyToken, opts)` where
 *    `verifyToken: (req, bearerToken?) => Promise<AuthInfo | undefined>`
 *  - the MCP TypeScript SDK: `requireBearerAuth({ verifier })` where `verifier` is an
 *    `OAuthTokenVerifier` — an object with `verifyAccessToken(token): Promise<AuthInfo>`
 *
 * Both consume the same `AuthInfo`. So `createMcpTokenVerifier` returns a value that satisfies
 * *both* — it is callable like the first and carries a `verifyAccessToken` method like the second —
 * and Hexclave never needs to ship a per-framework adapter, now or when the next framework appears.
 *
 * We deliberately do NOT export a `withMcpAuth`. That name is already taken by `mcp-handler` with a
 * different signature, and MCP developers routinely have both installed; shipping ours would force
 * an import alias on everyone. (Better Auth made this exact mistake and is now renaming theirs.)
 * Wrapping the handler would also mean owning transport concerns — CORS, SSE, `[transport]` routing —
 * that belong to the MCP framework, not to an auth provider.
 */

/**
 * The MCP ecosystem's shared auth type, structurally redeclared.
 *
 * Intentionally not imported from `@modelcontextprotocol/sdk` or `mcp-handler`: an auth provider
 * should not force a dependency on any one MCP framework, and the SDK is mid-v1→v2 migration. This
 * is structurally compatible with both, which is all either one requires.
 *
 * The e2e tests assert assignability against the real packages, so drift becomes a build failure
 * rather than a silent break at runtime.
 */
export type McpAuthInfo = {
  token: string,
  clientId: string,
  scopes: string[],
  expiresAt?: number,
  resource?: URL,
  extra?: Record<string, unknown>,
};

export type McpTokenVerifierOptions = {
  /** The Hexclave project the MCP server belongs to. */
  projectId: string,
  /**
   * The Hexclave API base URL. Defaults to the Hexclave cloud; self-hosters pass their own.
   */
  baseUrl?: string,
  /**
   * This MCP server's resource identifier (RFC 8707) — the canonical URL of the MCP endpoint, e.g.
   * `https://mcp.acme.com/mcp`.
   *
   * When omitted, the resource is taken from the incoming request URL, which is right for most
   * deployments. Pass it explicitly when the server sits behind a proxy that rewrites the URL, since
   * in that case the request URL isn't what the client used.
   */
  resource?: string,
};

/**
 * Satisfies `mcp-handler`'s `verifyToken` parameter and the MCP SDK's `OAuthTokenVerifier` at the
 * same time, so one export drops into either.
 */
export type McpTokenVerifier =
  ((request: Request, bearerToken?: string) => Promise<McpAuthInfo | undefined>)
  & { verifyAccessToken: (token: string) => Promise<McpAuthInfo> };

const DEFAULT_BASE_URL = "https://api.hexclave.com";

/**
 * Thrown when a token is structurally valid but not acceptable here. Distinct messages per cause,
 * because "invalid token" is the least actionable error an MCP developer can receive.
 */
export class McpTokenVerificationError extends Error {
  constructor(message: string, public readonly reason: "invalid_token" | "wrong_resource" | "wrong_issuer") {
    super(message);
    this.name = "McpTokenVerificationError";
  }
}

/**
 * Creates a token verifier for an MCP server.
 *
 * Standalone by design: it takes a `projectId` and nothing else, needs no Hexclave server app, and
 * — because verification is public-key only — needs **no secret key**. That matters because the
 * common deployment is an MCP server running as its own service, separate from the app that
 * configured Hexclave. Verification is a local JWT check against a cached remote JWKS, so there is
 * no network round trip to Hexclave on the hot path.
 *
 * ```ts
 * import { createMcpTokenVerifier } from "@hexclave/js/mcp";  // replace `js` with the correct framework SDK package
 *
 * const verify = createMcpTokenVerifier({
 *   projectId: process.env.HEXCLAVE_PROJECT_ID!,
 *   resource: "https://mcp.acme.com/mcp",
 * });
 * ```
 *
 * A configured server app can produce one with `projectId`/`baseUrl` already filled in via
 * `hexclaveServerApp.createMcpTokenVerifier(...)`; this is that method's implementation.
 */
export function createMcpTokenVerifier(options: McpTokenVerifierOptions): McpTokenVerifier {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const issuer = getOAuthIssuerUrl({ projectId: options.projectId, baseUrl });

  // One JWKS per verifier, cached by `jose` across calls. Creating it lazily keeps construction
  // synchronous and side-effect free, which matters because verifiers are usually built at module
  // scope where a network call would be surprising.
  let jwkSet: ReturnType<typeof jose.createRemoteJWKSet> | undefined;
  const getJwkSet = () => {
    if (!jwkSet) {
      const jwksUrl = new URL(`/api/v1/projects/${encodeURIComponent(options.projectId)}/.well-known/jwks.json`, baseUrl);
      jwkSet = jose.createRemoteJWKSet(jwksUrl);
    }
    return jwkSet;
  };

  const verifyAccessToken = async (token: string, resource?: string): Promise<McpAuthInfo> => {
    const expectedResource = options.resource ?? resource;

    let payload: jose.JWTPayload;
    try {
      const verified = await jose.jwtVerify(token, getJwkSet(), { issuer });
      payload = verified.payload;
    } catch (error) {
      // `jose` distinguishes a bad issuer from a bad signature, and so should we — an issuer
      // mismatch almost always means the wrong `projectId` or `baseUrl`, which is a one-line fix
      // the developer can only make if we say so.
      if (error instanceof jose.errors.JWTClaimValidationFailed && error.claim === "iss") {
        throw new McpTokenVerificationError(
          `This token was not issued by Hexclave project ${options.projectId}. Expected issuer ${issuer}. Check the projectId and baseUrl passed to createMcpTokenVerifier.`,
          "wrong_issuer",
        );
      }
      throw new McpTokenVerificationError(
        `The access token could not be verified: ${error instanceof Error ? error.message : String(error)}`,
        "invalid_token",
      );
    }

    // RFC 8707 audience binding. Hexclave mints a token whose audience is derived per resource
    // server, so a token for another MCP server is signed by a different key and would already have
    // failed above. This check is the second, independent layer: it catches the case where two
    // resource servers share a project *and* something upstream got the key selection wrong, and it
    // produces a legible error instead of a confusing signature failure.
    if (expectedResource !== undefined) {
      const audiences = payload.aud === undefined ? [] : (Array.isArray(payload.aud) ? payload.aud : [payload.aud]);
      const tokenResource = typeof payload.resource === "string" ? payload.resource : undefined;
      const matches = tokenResource === expectedResource
        || audiences.includes(expectedResource);
      if (!matches) {
        const actual = tokenResource ?? (audiences.length > 0 ? audiences.join(", ") : "an unknown resource");
        throw new McpTokenVerificationError(
          `This token was issued for a different resource. This server's resource identifier is ${expectedResource}, but the token is for ${actual}.`,
          "wrong_resource",
        );
      }
    }

    // Scopes are space-delimited in the OAuth spec, but be tolerant of an array: some providers, and
    // some of our own older code paths, emit one.
    const rawScope = payload.scope ?? payload.scopes;
    const scopes = Array.isArray(rawScope)
      ? rawScope.filter((s): s is string => typeof s === "string")
      : typeof rawScope === "string" ? rawScope.split(" ").filter(s => s.length > 0) : [];

    return {
      token,
      clientId: typeof payload.client_id === "string" ? payload.client_id : "",
      scopes,
      expiresAt: payload.exp,
      resource: expectedResource === undefined ? undefined : new URL(expectedResource),
      extra: {
        // The Hexclave user ID. Pass the whole `AuthInfo` to
        // `hexclaveServerApp.getUser({ from: "mcp", authInfo })` to resolve it to a `ServerUser`.
        userId: payload.sub,
        projectId: options.projectId,
      },
    };
  };

  const verifier = (async (request: Request, bearerToken?: string) => {
    const token = bearerToken ?? extractBearerToken(request);
    if (token === undefined) return undefined;
    // With no explicitly configured resource, the request URL *is* the resource identifier — which
    // is correct whenever the server isn't behind a URL-rewriting proxy, and is what lets the
    // zero-config case work.
    return await verifyAccessToken(token, options.resource ?? request.url);
  }) as McpTokenVerifier;

  verifier.verifyAccessToken = (token: string) => verifyAccessToken(token);

  return verifier;
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (header === null) return undefined;
  const match = /^Bearer (.+)$/i.exec(header);
  return match?.[1];
}

/**
 * The OAuth issuer URL for a Hexclave project acting as an authorization server.
 *
 * This is exactly the string `mcp-handler`'s `protectedResourceHandler({ authServerUrls })` wants,
 * and the `authorization_servers` entry RFC 9728 requires:
 *
 * ```ts
 * export const GET = protectedResourceHandler({
 *   authServerUrls: [getOAuthIssuerUrl({ projectId })],
 * });
 * export const OPTIONS = metadataCorsOptionsRequestHandler();
 * ```
 */
export function getOAuthIssuerUrl(options: { projectId: string, baseUrl?: string }): string {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  return new URL(`/api/v1/projects/${encodeURIComponent(options.projectId)}/oidc`, baseUrl).toString();
}

if (import.meta.vitest) {
  const { test, expect, describe } = import.meta.vitest;

  const projectId = "e0b52f4d-dece-408c-af49-d23061bb0f8d";

  describe("getOAuthIssuerUrl", () => {
    test("builds the project OIDC issuer", () => {
      expect(getOAuthIssuerUrl({ projectId, baseUrl: "https://api.example.com" }))
        .toBe(`https://api.example.com/api/v1/projects/${projectId}/oidc`);
    });

    test("defaults to the Hexclave cloud", () => {
      expect(getOAuthIssuerUrl({ projectId })).toBe(`${DEFAULT_BASE_URL}/api/v1/projects/${projectId}/oidc`);
    });
  });

  describe("createMcpTokenVerifier", () => {
    // The DX contract: one export that both ecosystems accept. If either of these shapes stops
    // holding, every documented snippet breaks, so assert them directly rather than trusting the
    // type annotation to have been kept honest.
    test("is callable like mcp-handler's verifyToken AND carries the MCP SDK's verifyAccessToken", () => {
      const verifier = createMcpTokenVerifier({ projectId, resource: "https://mcp.example.com/mcp" });
      expect(typeof verifier).toBe("function");
      expect(typeof verifier.verifyAccessToken).toBe("function");
    });

    test("constructs without a secret key or a server app — the remote-MCP-server case", () => {
      // No network, no credentials, no configured app: just a project ID. This is what makes an MCP
      // server deployable as its own service.
      expect(() => createMcpTokenVerifier({ projectId })).not.toThrow();
    });

    test("returns undefined when there is no bearer token, rather than throwing", () => {
      // `mcp-handler` distinguishes "no token" (respond 401 with a WWW-Authenticate challenge) from
      // "bad token" (an error). Returning undefined is what produces the correct challenge.
      const verifier = createMcpTokenVerifier({ projectId });
      const request = new Request("https://mcp.example.com/mcp");
      return expect(verifier(request)).resolves.toBeUndefined();
    });

    test("ignores a non-Bearer authorization header", async () => {
      const verifier = createMcpTokenVerifier({ projectId });
      const request = new Request("https://mcp.example.com/mcp", {
        headers: { authorization: "Basic dXNlcjpwYXNz" },
      });
      await expect(verifier(request)).resolves.toBeUndefined();
    });
  });

  describe("McpTokenVerificationError", () => {
    test("carries a machine-readable reason alongside the message", () => {
      const error = new McpTokenVerificationError("nope", "wrong_resource");
      expect(error.reason).toBe("wrong_resource");
      expect(error).toBeInstanceOf(Error);
    });
  });
}
