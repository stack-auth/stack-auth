import { createOidcProviderInternal } from "@/app/api/latest/integrations/idp";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { getOrUndefined } from "@hexclave/shared/dist/utils/objects";
import type { AdapterPayload, ClientMetadata } from "oidc-provider";
import { assertSafeOAuthUrlWithoutDns } from "./ssrf-protection/oauth";
import { deriveScopesFromConfig } from "./permissions";
import { getResourceAudience } from "./tokens";
import { Tenancy } from "./tenancies";

/**
 * A Hexclave project acting as its own OAuth 2.1 / OIDC provider.
 *
 * This is the generic capability; MCP is a thin profile on top of it. An MCP server is just a
 * resource server (RFC 8707) whose clients happen to be AI agents, so nothing in this file is
 * MCP-specific — the MCP-shaped parts are the discovery documents and the SDK verifier.
 *
 * Reuses the `oidc-provider` instance that already powers the Neon/custom integration IdPs; see
 * `createOidcProviderInternal`. The per-tenancy differences are all passed in as options.
 */

/**
 * The `idpId` partition key for a project's provider, used both for `IdPAdapterData` rows and as the
 * signing-key derivation salt.
 *
 * Includes the branch because config (and therefore the scope vocabulary and client list) is
 * per-branch. Two branches of the same project are genuinely different authorization servers.
 *
 * This string is permanent: changing its shape orphans every stored grant and rotates every signing
 * key, silently signing users out of every connected app.
 */
export function getProjectIdpId(tenancy: Tenancy): string {
  return `project:${tenancy.project.id}:${tenancy.branchId}`;
}

/**
 * The `iss` of tokens minted by a project's own provider.
 *
 * Deliberately a *different* path from the classic `/api/v1/projects/{id}` issuer used for session
 * tokens. It cannot live at `/api/v1/projects/{id}` itself — a catch-all route there would swallow
 * every existing project endpoint — and keeping it distinct is one of the two mechanisms that stop
 * an OAuth-provider token being replayed as a session token. See `getAllowedIssuers` in
 * `lib/tokens.tsx` for the other side of that.
 */
export function getProjectOAuthIssuer(projectId: string, apiUrl?: string): string {
  const baseUrl = apiUrl ?? getEnvVariable("NEXT_PUBLIC_STACK_API_URL");
  return new URL(urlString`/api/v1/projects/${projectId}/oidc`, baseUrl).toString();
}

/**
 * Resource servers registered on this project, keyed by the resource URI a client passes as
 * `resource=`.
 *
 * The audience is derived, not stored: it comes from `getResourceAudience`, which is also what makes
 * the token cryptographically unusable at any other resource server (distinct audience ⇒ distinct
 * signing key). Deriving rather than storing means the two can never drift apart.
 */
export function getProjectResourceServers(tenancy: Tenancy): Map<string, { audience: string, scopes: string[] }> {
  const allScopes = deriveScopesFromConfig(tenancy.config).map(s => s.scope);

  return new Map(
    // `Object.entries`, not `typedEntries`: on a record with an index signature the latter widens
    // the key to `string | symbol`, and the resource ID has to be a string to go into an audience.
    Object.entries(tenancy.config.oauthProvider.resources).flatMap(([resourceId, resource]) => {
      // A resource with no URI has been half-configured in the dashboard — it can't be targeted by
      // `resource=`, so it simply isn't a resource server yet. Skipping is right; throwing would
      // take down the whole provider over one incomplete row.
      if (resource.uri === undefined) return [];

      const declaredScopes = resource.scopes === undefined
        ? undefined
        : Object.values(resource.scopes).flatMap(s => s.scope === undefined ? [] : [s.scope]);
      return [[resource.uri, {
        audience: getResourceAudience(tenancy.project.id, resourceId),
        // An empty scope list means "every scope this project defines" rather than "no scopes":
        // the common case is a customer who registered an MCP server and never narrowed it, and
        // handing that server a token with no scopes at all would be useless.
        scopes: declaredScopes && declaredScopes.length > 0 ? declaredScopes : allScopes,
      }]] as const;
    }),
  );
}

/**
 * Clients declared in the project's config, in the shape `oidc-provider` expects.
 *
 * Note that `trusted` is deliberately *not* forwarded — it is a Hexclave concept (skip the consent
 * prompt) that the OIDC provider has no notion of, and it is read separately at consent time. See
 * `isTrustedClient`.
 */
export function getProjectStaticClients(tenancy: Tenancy): ClientMetadata[] {
  return Object.entries(tenancy.config.oauthProvider.clients).map(([clientId, client]) => ({
    client_id: clientId,
    client_name: client.displayName,
    // Keyed by opaque ID in config with the URL as a value — see the schema comment on
    // `redirectUris` for why a URL can't be a config key.
    redirect_uris: Object.values(client.redirectUris ?? {}).flatMap(uri => uri.url === undefined ? [] : [uri.url]),
    // Public clients (native apps, CLIs, most MCP clients) can't hold a secret, so they authenticate
    // with PKCE alone.
    token_endpoint_auth_method: client.type === "confidential" ? "client_secret_basic" : "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    // MCP clients are overwhelmingly native/CLI apps that listen on a loopback port.
    application_type: "native",
  }));
}

/**
 * Whether a client may skip the consent *prompt*.
 *
 * Only ever true for clients declared in config. A client that registered itself — via dynamic
 * client registration or by serving a client ID metadata document — must not be able to declare
 * itself first-party, so those paths never consult anything but this function, and this function
 * only ever reads config.
 *
 * Skipping consent skips the prompt, never the authority check: the intersection rule in
 * `lib/scopes.tsx` applies to a trusted client's tokens exactly as it does to anyone else's.
 */
export function isTrustedClient(tenancy: Tenancy, clientId: string): boolean {
  // `getOrUndefined` rather than a direct index: `clientId` is attacker-controlled here, and a plain
  // lookup would happily resolve `__proto__` or `constructor` to something truthy.
  const client = getOrUndefined(tenancy.config.oauthProvider.clients, clientId);
  return client?.trusted === true;
}

/**
 * Resolves a `client_id` that is an HTTPS URL by fetching the OAuth Client ID Metadata Document it
 * points at (`draft-ietf-oauth-client-id-metadata-document`).
 *
 * This is where the MCP ecosystem is heading — it replaces dynamic client registration with
 * something that needs no write path at all. `oidc-provider` v8 predates the draft, so we hook it in
 * through the adapter's `Client` lookup (see `onFindMiss` in `idp.ts`), which means a CIMD client is
 * indistinguishable from a registered one everywhere else in the provider.
 *
 * Security notes, in order of importance:
 *  - This runs on an **unauthenticated** request, so it is a remote-fetch primitive an attacker can
 *    aim. Every URL goes through `assertSafeOAuthUrlWithoutDns` (HTTPS only, no private/reserved
 *    addresses) before we touch the network.
 *  - The document's own `client_id` must equal the URL exactly. Without that check, any host could
 *    serve a document claiming to be some other client.
 *  - `trusted` is never read from the document. A client cannot promote itself to first-party.
 */
export async function resolveClientIdMetadataDocument(
  tenancy: Tenancy,
  clientId: string,
): Promise<AdapterPayload | undefined> {
  const config = tenancy.config.oauthProvider.clientIdMetadataDocuments;
  if (!config.enabled) return undefined;
  if (!clientId.startsWith("https://")) return undefined;

  const url = assertSafeOAuthUrlWithoutDns(clientId);

  const allowedDomains = config.allowedDomains === undefined
    ? undefined
    : Object.values(config.allowedDomains).flatMap(d => d.domain === undefined ? [] : [d.domain]);
  if (allowedDomains !== undefined && allowedDomains.length > 0 && !allowedDomains.includes(url.hostname)) {
    return undefined;
  }

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return undefined;

  const document: unknown = await response.json();
  if (typeof document !== "object" || document === null) return undefined;
  const doc = document as Record<string, unknown>;

  // The document must claim exactly the URL it was served from. Anything else means the document is
  // impersonating a different client.
  if (doc.client_id !== clientId) return undefined;

  const redirectUris = doc.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.some(uri => typeof uri !== "string")) return undefined;

  return {
    client_id: clientId,
    client_name: typeof doc.client_name === "string" ? doc.client_name : undefined,
    redirect_uris: redirectUris,
    // A CIMD client has no way to hold a secret — the document is public — so it is always a public
    // client and always authenticates with PKCE alone.
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    application_type: "native",
  };
}

/**
 * Builds the OIDC provider for a project.
 *
 * Callers should go through the cache in the route rather than calling this per request —
 * constructing a `Provider` is expensive.
 */
export async function createProjectOAuthProvider(tenancy: Tenancy, options?: { apiUrl?: string }) {
  const scopes = deriveScopesFromConfig(tenancy.config).map(s => s.scope);
  const providerConfig = tenancy.config.oauthProvider;

  return await createOidcProviderInternal({
    id: getProjectIdpId(tenancy),
    baseUrl: getProjectOAuthIssuer(tenancy.project.id, options?.apiUrl),
    clients: getProjectStaticClients(tenancy),
    findClient: providerConfig.clientIdMetadataDocuments.enabled
      ? async (clientId) => await resolveClientIdMetadataDocument(tenancy, clientId)
      : undefined,
    scopes,
    resourceServers: getProjectResourceServers(tenancy),
    features: {
      registration: providerConfig.dynamicClientRegistration.enabled,
      // Always on: without it there is no way for a user to disconnect an app they granted access to,
      // and a consent screen you can't revoke is not really consent.
      revocation: true,
    },
    // OAuth 2.1 and the MCP authorization spec both require PKCE unconditionally.
    requirePkce: true,
  });
}
