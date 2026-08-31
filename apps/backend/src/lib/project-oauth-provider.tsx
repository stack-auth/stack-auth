import { allowNonReverseDomainNativeRedirectSchemes, createOidcProviderInternal, getIdpJwksKeyDerivationAudience } from "@/app/api/latest/integrations/idp";
import { PROJECT_OAUTH_PROVIDER_JWKS_PATH, canonicalizeResourceUri, getProjectOAuthProviderIssuerUrl } from "@hexclave/shared/dist/utils/urls";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { getPrivateJwks, getPublicJwkSet } from "@hexclave/shared/dist/utils/jwt";
import { getOrUndefined } from "@hexclave/shared/dist/utils/objects";
import * as jose from "jose";
import type { AdapterPayload, ClientMetadata } from "oidc-provider";
import { assertSafeOAuthUrlWithoutDns, fetchOAuthJsonDocument } from "./ssrf-protection/oauth";
import { getResourceAudience, tryParseAudience } from "./tokens";
import { Tenancy } from "./tenancies";
import { PROJECT_OAUTH_OIDC_SCOPES } from "./project-oauth-scopes";
import {
  findProjectOAuthAccount,
  installProjectOAuthInteractionMiddleware,
} from "./project-oauth-interaction";

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
  return getProjectOAuthProviderIssuerUrl(projectId, apiUrl ?? getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
}

export function getProjectOAuthProviderUrl(projectId: string, path: string, apiUrl?: string): string {
  const url = new URL(getProjectOAuthIssuer(projectId, apiUrl));
  url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`;
  return url.toString();
}

export function getProjectResourceServers(tenancy: Tenancy): Map<string, { audience: string }> {
  const resourceServers = new Map<string, { audience: string }>();
  for (const [resourceId, resource] of Object.entries(tenancy.config.oauthProvider.resources)) {
    if (resource.uri === undefined) continue;
    const canonicalUri = canonicalizeResourceUri(resource.uri);
    if (resourceServers.has(canonicalUri)) {
      captureError("duplicate-oauth-resource-uri", new Error(`Duplicate OAuth resource URI ${JSON.stringify(resource.uri)}; keeping the first configured resource ${JSON.stringify(resourceId)}.`));
      continue;
    }
    resourceServers.set(canonicalUri, {
      audience: getResourceAudience(tenancy.project.id, resourceId),
    });
  }
  return resourceServers;
}

export function getProjectStaticClients(tenancy: Tenancy): ClientMetadata[] {
  return Object.entries(tenancy.config.oauthProvider.clients).flatMap(([clientId, client]) => {
    const redirectUris = Object.values(client.redirectUris).flatMap(uri => uri.url === undefined ? [] : [uri.url]);
    if (redirectUris.length === 0) return [];
    return [{
      client_id: clientId,
      client_name: client.displayName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      id_token_signed_response_alg: "ES256",
      application_type: "native",
    }];
  });
}

export function isTrustedClient(tenancy: Tenancy, clientId: string): boolean {
  // `clientId` is attacker-controlled; a plain index would resolve `__proto__` / `constructor`.
  const client = getOrUndefined(tenancy.config.oauthProvider.clients, clientId);
  return client?.trusted === true;
}

export async function resolveClientIdMetadataDocument(
  tenancy: Tenancy,
  clientId: string,
): Promise<AdapterPayload | undefined> {
  const config = tenancy.config.oauthProvider.clientIdMetadataDocuments;
  if (!config.enabled) return undefined;
  if (!clientId.startsWith("https://")) return undefined;

  const url = assertSafeOAuthUrlWithoutDns(clientId);

  const allowedDomains = Object.values(config.allowedDomains).flatMap(d => d.domain === undefined ? [] : [d.domain]);
  if (allowedDomains.length > 0 && !allowedDomains.includes(url.hostname)) {
    return undefined;
  }

  let document: unknown;
  try {
    document = await fetchOAuthJsonDocument(url);
  } catch (error) {
    captureError("oauth-client-metadata-fetch-failed", error);
    console.warn("OAuth client metadata could not be fetched.");
    return undefined;
  }
  if (typeof document !== "object" || document === null) return undefined;
  const doc = document as Record<string, unknown>;

  if (doc.client_id !== clientId) return undefined;

  const redirectUris = doc.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.some(uri => typeof uri !== "string")) return undefined;

  return {
    client_id: clientId,
    client_name: typeof doc.client_name === "string" ? doc.client_name : undefined,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    id_token_signed_response_alg: "ES256",
    application_type: "native",
  };
}

export async function verifyProjectOAuthAccessToken(
  tenancy: Tenancy,
  accessToken: string,
  options?: { allowedResourceIds?: ReadonlySet<string> },
): Promise<{ userId: string, resourceId: string } | null> {
  const privateJwks = await getPrivateJwks({ audience: getIdpJwksKeyDerivationAudience(getProjectIdpId(tenancy)) });
  const jwkSet = jose.createLocalJWKSet(await getPublicJwkSet(privateJwks));
  let payload: jose.JWTPayload;
  try {
    ({ payload } = await jose.jwtVerify(accessToken, jwkSet, { issuer: getProjectOAuthIssuer(tenancy.project.id) }));
  } catch (error) {
    if (error instanceof jose.errors.JOSEError) return null;
    throw error;
  }
  const aud = typeof payload.aud === "string" ? payload.aud : undefined;
  const parsedAud = aud === undefined ? null : tryParseAudience(aud);
  if (parsedAud?.type !== "resource" || parsedAud.projectId !== tenancy.project.id) return null;
  if (getOrUndefined(tenancy.config.oauthProvider.resources, parsedAud.resourceId) === undefined) return null;
  if (options?.allowedResourceIds != null && !options.allowedResourceIds.has(parsedAud.resourceId)) return null;
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
  return { userId: payload.sub, resourceId: parsedAud.resourceId };
}

export async function createProjectOAuthProvider(
  tenancy: Tenancy,
  options?: {
    apiUrl?: string,
  },
) {
  const providerConfig = tenancy.config.oauthProvider;
  const resourceServers = getProjectResourceServers(tenancy);
  const issuer = getProjectOAuthIssuer(tenancy.project.id, options?.apiUrl);
  const resourceUrisByAudience = new Map([...resourceServers].map(([uri, resource]) => [resource.audience, uri]));

  const provider = await createOidcProviderInternal({
    id: getProjectIdpId(tenancy),
    baseUrl: issuer,
    clients: getProjectStaticClients(tenancy),
    // Unset `id_token_signed_response_alg` makes oidc-provider default to RS256; this key set is ES256-only.
    clientDefaults: {
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      id_token_signed_response_alg: "ES256",
      // "native", not oidc-provider's default "web": MCP clients redirect to loopback URLs
      // (http://localhost:<port>/callback) or custom schemes (vscode://..., cursor://...), both of
      // which oidc-provider rejects for web clients ("redirect_uris must only contain web uris").
      application_type: "native",
    },
    findClient: async (clientId) => await resolveClientIdMetadataDocument(tenancy, clientId),
    scopes: [...PROJECT_OAUTH_OIDC_SCOPES],
    resourceServers,
    extraTokenClaims: async (_ctx, token) => {
      const audience = token.resourceServer?.audience;
      const resource = audience === undefined ? undefined : resourceUrisByAudience.get(audience);
      return resource === undefined ? undefined : { resource };
    },
    features: {
      registration: providerConfig.dynamicClientRegistration.enabled,
      revocation: true,
    },
    requirePkce: true,
    userFacingAuthorizationErrors: true,
    findAccount: async (_ctx, sub) => await findProjectOAuthAccount(tenancy, sub),
    middleware: (oidc) => installProjectOAuthInteractionMiddleware(oidc, tenancy),
    jwksRoute: PROJECT_OAUTH_PROVIDER_JWKS_PATH,
  });
  // MCP clients register plain product schemes (vscode://, cursor://) as native redirect URIs;
  // scoped to project providers on purpose — the neon/custom integration IdPs keep strict defaults.
  allowNonReverseDomainNativeRedirectSchemes(provider);
  return provider;
}
