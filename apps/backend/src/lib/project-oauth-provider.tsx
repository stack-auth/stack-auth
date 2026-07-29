import { createOidcProviderInternal, OIDC_JWT_SIGNING_ALGORITHM, wrapOidcMiddleware } from "@/app/api/latest/integrations/idp";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { getOrUndefined } from "@hexclave/shared/dist/utils/objects";
import type { AdapterPayload, ClientMetadata, Configuration } from "oidc-provider";
import { assertSafeOAuthUrlWithoutDns, fetchOAuthJsonDocument } from "./ssrf-protection/oauth";
import { deriveScopesFromConfig, listPermissions } from "./permissions";
import { getResourceAudience } from "./tokens";
import { Tenancy } from "./tenancies";
import { getUser } from "@/app/api/latest/users/crud";
import { getHostedHandlerTrustedDomain } from "./redirect-urls";
import { globalPrismaClient, getPrismaClientForTenancy } from "@/prisma-client";
import { createHash, randomBytes } from "node:crypto";
import { narrowPermissionsByScopes, OIDC_STANDARD_SCOPES } from "@hexclave/shared/dist/config/scopes";

type ProjectOAuthAccount = Awaited<ReturnType<NonNullable<Configuration["findAccount"]>>>;

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
 * The audience is derived, not stored, so the resource map and audience cannot drift apart. Resource
 * authorization is enforced by the issuer and mandatory resource claim checks; signing keys are
 * shared by providers within a project.
 */
export function getProjectResourceServers(tenancy: Tenancy): Map<string, { audience: string, scopes: string[] }> {
  const allScopes = deriveScopesFromConfig(tenancy.config).map(s => s.scope);
  const resourceServers = new Map<string, { audience: string, scopes: string[] }>();
  for (const [resourceId, resource] of Object.entries(tenancy.config.oauthProvider.resources)) {
    // A resource with no URI has been half-configured in the dashboard, so it is not targetable yet.
    if (resource.uri === undefined) continue;
    const canonicalUri = canonicalResourceUri(resource.uri);
    if (resourceServers.has(canonicalUri)) {
      captureError("duplicate-oauth-resource-uri", new Error(`Duplicate OAuth resource URI ${JSON.stringify(resource.uri)}; keeping the first configured resource ${JSON.stringify(resourceId)}.`));
      continue;
    }
    resourceServers.set(canonicalUri, {
      audience: getResourceAudience(tenancy.project.id, resourceId),
      scopes: (() => {
        const declaredScopes = Object.values(resource.scopes).flatMap(s => s.scope === undefined ? [] : [s.scope]);
        // An empty scope list means every scope the project defines.
        return declaredScopes.length > 0 ? declaredScopes : allScopes;
      })(),
    });
  }
  return resourceServers;
}

function canonicalResourceUri(uri: string): string {
  const url = new URL(uri);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

/**
 * Clients declared in the project's config, in the shape `oidc-provider` expects.
 *
 * Note that `trusted` is deliberately *not* forwarded — it is a Hexclave concept (skip the consent
 * prompt) that the OIDC provider has no notion of, and it is read separately at consent time. See
 * `isTrustedClient`.
 */
export function getProjectStaticClients(tenancy: Tenancy): ClientMetadata[] {
  return Object.entries(tenancy.config.oauthProvider.clients).flatMap(([clientId, client]) => {
    // Keyed by opaque ID in config with the URL as a value — see the schema comment on
    // `redirectUris` for why a URL can't be a config key.
    // CompleteConfig supplies an empty redirect-URI record when none was configured. A row may
    // still be half-filled while it is being edited in the dashboard, so skip that row.
    const redirectUris = Object.values(client.redirectUris).flatMap(uri => uri.url === undefined ? [] : [uri.url]);
    if (redirectUris.length === 0) return [];
    return [{
      client_id: clientId,
      client_name: client.displayName,
      redirect_uris: redirectUris,
      // Public clients (native apps, CLIs, most MCP clients) can't hold a secret, so they authenticate
      // with PKCE alone.
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // MCP clients are overwhelmingly native/CLI apps that listen on a loopback port.
      application_type: "native",
      id_token_signed_response_alg: OIDC_JWT_SIGNING_ALGORITHM,
    }];
  });
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

export async function findProjectOAuthAccount(
  tenancy: Tenancy,
  sub: string,
): Promise<ProjectOAuthAccount> {
  const user = await getUser({ tenancy, userId: sub });
  if (!user) return undefined;

  return {
    accountId: user.id,
    async claims(_use, scope) {
      const scopes = new Set(scope.split(" ").filter(Boolean));
      return {
        sub: user.id,
        ...(scopes.has("email") ? {
          email: user.primary_email ?? undefined,
          email_verified: user.primary_email_verified,
        } : {}),
        ...(scopes.has("profile") ? {
          name: user.display_name ?? undefined,
          picture: user.profile_image_url ?? undefined,
        } : {}),
      };
    },
  };
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : undefined;
}

function getObjectProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Reflect.get(value, key);
}

export function getProjectOAuthInteractionUrl(tenancy: Tenancy, uid: string): string {
  const url = new URL("/handler/oauth-consent", getHostedHandlerTrustedDomain(tenancy.project.id));
  // The hosted consent route must preserve interaction_uid through sign-in and use it for both
  // metadata lookup and the one-time approval-code continuation.
  url.searchParams.set("interaction_uid", uid);
  return url.toString();
}

export function installProjectOAuthInteractionMiddleware(oidc: Awaited<ReturnType<typeof createOidcProviderInternal>>, tenancy: Tenancy): void {
  wrapOidcMiddleware(oidc, async (ctx, next) => {
    const interactionMatch = /^\/interaction\/([^/]+)$/.exec(ctx.path);
    if (ctx.method === "GET" && interactionMatch) {
      const details = await oidc.interactionDetails(ctx.req, ctx.res);
      const interactionUrl = new URL(getProjectOAuthInteractionUrl(tenancy, interactionMatch[1]));
      ctx.redirect(interactionUrl.toString());
      return;
    }

    const doneMatch = /^\/interaction\/([^/]+)\/done$/.exec(ctx.path);
    if (doneMatch && (ctx.method === "GET" || ctx.method === "POST")) {
      const interaction = await oidc.Interaction.find(doneMatch[1]);
      if (ctx.request.query.error === "access_denied") {
        if (interaction == null || interaction.uid !== doneMatch[1] || interaction.exp <= Math.floor(Date.now() / 1000)) {
          ctx.status = 400;
          ctx.body = "Invalid interaction code.";
          return;
        }
        const redirectUri = getStringProperty(interaction.params, "redirect_uri");
        if (redirectUri === undefined) {
          ctx.status = 400;
          ctx.body = "Invalid interaction code.";
          return;
        }
        const redirect = new URL(redirectUri);
        redirect.searchParams.set("error", "access_denied");
        redirect.searchParams.set("error_description", "The resource owner denied the request.");
        const state = getStringProperty(interaction.params, "state");
        if (state !== undefined) redirect.searchParams.set("state", state);
        await interaction.destroy();
        await globalPrismaClient.idPAdapterData.deleteMany({
          where: {
            idpId: getProjectIdpId(tenancy),
            model: "Interaction",
            id: doneMatch[1],
          },
        });
        ctx.status = 303;
        ctx.redirect(redirect.toString());
        return;
      }
      const code = typeof ctx.request.query.code === "string" ? ctx.request.query.code : undefined;
      const codeHash = code === undefined ? undefined : createHash("sha256").update(code).digest("hex");
      const storedCode = codeHash === undefined ? undefined : await globalPrismaClient.projectOAuthInteractionCode.findFirst({
        where: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          interactionUid: doneMatch[1],
          codeHash,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (storedCode == null) {
        ctx.status = 400;
        ctx.body = "Invalid interaction code.";
        return;
      }

      const marked = await globalPrismaClient.projectOAuthInteractionCode.updateMany({
        where: { id: storedCode.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (marked.count !== 1) {
        ctx.status = 400;
        ctx.body = "Invalid interaction code.";
        return;
      }

      if (interaction == null || interaction.uid !== doneMatch[1]) {
        ctx.status = 400;
        ctx.body = "Invalid interaction code.";
        return;
      }
      const grant = new oidc.Grant({
        accountId: storedCode.userId,
        clientId: storedCode.clientId,
      });
      const scopes = storedCode.scope.split(" ").filter(Boolean);
      const oidcStandardScopes = new Set<string>(OIDC_STANDARD_SCOPES);
      const oidcScopes = scopes.filter(scope => oidcStandardScopes.has(scope));
      const resourceScopes = scopes.filter(scope => !oidcStandardScopes.has(scope));
      const requestedScopes = getStringProperty(interaction.params, "scope")?.split(" ").filter(Boolean) ?? [];
      const grantedScopes = new Set(scopes);
      const rejectedScopes = requestedScopes.filter(scope => !grantedScopes.has(scope));
      if (oidcScopes.length > 0) grant.addOIDCScope(oidcScopes.join(" "));
      if (storedCode.resource !== null && resourceScopes.length > 0) {
        grant.addResourceScope(storedCode.resource, resourceScopes.join(" "));
      } else if (storedCode.resource === null && resourceScopes.length > 0) {
        grant.addOIDCScope(resourceScopes.join(" "));
      }
      const rejectedOIDCScopes = rejectedScopes.filter(scope => oidcStandardScopes.has(scope));
      if (rejectedOIDCScopes.length > 0) grant.rejectOIDCScope(rejectedOIDCScopes.join(" "));
      const rejectedResourceScopes = rejectedScopes.filter(scope => !oidcStandardScopes.has(scope));
      if (storedCode.resource !== null && rejectedResourceScopes.length > 0) {
        grant.rejectResourceScope(storedCode.resource, rejectedResourceScopes.join(" "));
      } else if (storedCode.resource === null && rejectedResourceScopes.length > 0) {
        grant.rejectOIDCScope(rejectedResourceScopes.join(" "));
      }
      const grantId = await grant.save(60 * 60);
      interaction.result = {
        login: { accountId: storedCode.userId },
        consent: { grantId },
      };
      const remainingSeconds = interaction.exp - Math.floor(Date.now() / 1000);
      if (remainingSeconds <= 0) {
        ctx.status = 400;
        ctx.body = "Invalid interaction code.";
        return;
      }
      await interaction.save(remainingSeconds);
      ctx.status = 303;
      ctx.redirect(interaction.returnTo);
      return;
    }
    await next();
  });
}

type ProjectOAuthApprovalResult =
  | { status: "invalid" }
  | { status: "ok", code: string };

export async function approveProjectOAuthInteraction(
  tenancy: Tenancy,
  interactionUid: string,
  userId: string,
): Promise<ProjectOAuthApprovalResult> {
  const interaction = await globalPrismaClient.idPAdapterData.findUnique({
    where: {
      idpId_model_id: {
        idpId: getProjectIdpId(tenancy),
        model: "Interaction",
        id: interactionUid,
      },
    },
  });
  if (interaction === null || interaction.expiresAt <= new Date()) return { status: "invalid" };

  const params = getObjectProperty(interaction.payload, "params");
  const clientId = getStringProperty(params, "client_id");
  const requestedResource = getStringProperty(params, "resource");
  const requestedScopes = getStringProperty(params, "scope")?.split(" ").filter(Boolean) ?? [];
  if (clientId === undefined) return { status: "invalid" };

  const resource = requestedResource === undefined ? undefined : getProjectResourceServers(tenancy).get(requestedResource);
  if (requestedResource !== undefined && resource === undefined) return { status: "invalid" };
  const grantedScopes = await narrowProjectOAuthScopes(tenancy, userId, requestedScopes, resource);
  const code = randomBytes(32).toString("base64url");
  await globalPrismaClient.projectOAuthInteractionCode.create({
    data: {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      interactionUid,
      userId,
      clientId,
      codeHash: createHash("sha256").update(code).digest("hex"),
      scope: grantedScopes.join(" "),
      resource: requestedResource ?? null,
      expiresAt: new Date(new Date().getTime() + 60_000),
    },
  });
  return { status: "ok", code };
}

async function narrowProjectOAuthScopes(
  tenancy: Tenancy,
  userId: string,
  requestedScopes: string[],
  resource: { scopes: string[] } | undefined,
): Promise<string[]> {
  const standardScopes = new Set<string>(OIDC_STANDARD_SCOPES);
  const allowedScopes = new Set([
    ...standardScopes,
    ...(resource?.scopes ?? deriveScopesFromConfig(tenancy.config).map(scope => scope.scope)),
  ]);
  const scopedRequested = requestedScopes.filter(scope => allowedScopes.has(scope));
  const tx = await getPrismaClientForTenancy(tenancy);
  const permissions = await listPermissions(tx, {
    tenancy,
    userId,
    recursive: true,
    scope: "project",
    grantedScopes: null,
  });
  const narrowedPermissions = narrowPermissionsByScopes(permissions, scopedRequested, "project");
  const permissionScopes = new Set(narrowedPermissions.map(permission => `perm:${permission.id}`));
  // Team permissions require an explicit team selection, which this project-level interaction
  // contract does not carry. Keep them out rather than guessing a team or over-granting.
  return scopedRequested.filter(scope =>
    scope.startsWith("team_perm:")
      ? false
      : !scope.startsWith("perm:") || permissionScopes.has(scope),
  );
}

export async function getProjectOAuthInteractionDetails(
  tenancy: Tenancy,
  interactionUid: string,
  userId: string,
): Promise<{
  clientId: string,
  clientName: string,
  scopes: string[],
  resource: string | undefined,
  trusted: boolean,
} | undefined> {
  const interaction = await globalPrismaClient.idPAdapterData.findUnique({
    where: { idpId_model_id: { idpId: getProjectIdpId(tenancy), model: "Interaction", id: interactionUid } },
  });
  if (interaction === null || interaction.expiresAt <= new Date()) return undefined;
  const params = getObjectProperty(interaction.payload, "params");
  const clientId = getStringProperty(params, "client_id");
  if (clientId === undefined) return undefined;
  const requestedResource = getStringProperty(params, "resource");
  const resource = requestedResource === undefined ? undefined : getProjectResourceServers(tenancy).get(requestedResource);
  if (requestedResource !== undefined && resource === undefined) return undefined;
  const requestedScopes = getStringProperty(params, "scope")?.split(" ").filter(Boolean) ?? [];
  const client = getOrUndefined(tenancy.config.oauthProvider.clients, clientId);
  return {
    clientId,
    clientName: client?.displayName ?? clientId,
    scopes: await narrowProjectOAuthScopes(tenancy, userId, requestedScopes, resource),
    resource: requestedResource,
    trusted: isTrustedClient(tenancy, clientId),
  };
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
 *    aim. The request uses a DNS-guarded connection, so the address checked by the resolver is the
 *    address actually connected to.
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

  const allowedDomains = Object.values(config.allowedDomains).flatMap(d => d.domain === undefined ? [] : [d.domain]);
  if (allowedDomains.length > 0 && !allowedDomains.includes(url.hostname)) {
    return undefined;
  }

  let document: unknown;
  try {
    document = await fetchOAuthJsonDocument(url);
  } catch (error) {
    // Client metadata lookup is an unauthenticated convenience path; all request and parse failures
    // must fail closed without exposing network or parser details to the caller.
    captureError("oauth-client-metadata-fetch-failed", error);
    console.warn("OAuth client metadata could not be fetched.");
    return undefined;
  }
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
    id_token_signed_response_alg: OIDC_JWT_SIGNING_ALGORITHM,
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
  const resourceServers = getProjectResourceServers(tenancy);
  const resourceUrisByAudience = new Map([...resourceServers].map(([uri, resource]) => [resource.audience, uri]));

  return await createOidcProviderInternal({
    id: getProjectIdpId(tenancy),
    baseUrl: getProjectOAuthIssuer(tenancy.project.id, options?.apiUrl),
    clients: getProjectStaticClients(tenancy),
    findClient: providerConfig.clientIdMetadataDocuments.enabled
      ? async (clientId) => await resolveClientIdMetadataDocument(tenancy, clientId)
      : undefined,
    findAccount: async (_ctx, sub) => await findProjectOAuthAccount(tenancy, sub),
    scopes,
    resourceServers,
    extraTokenClaims: async (_ctx, token) => {
      const audience = token.resourceServer?.audience;
      const resource = audience === undefined ? undefined : resourceUrisByAudience.get(audience);
      return resource === undefined ? undefined : { resource };
    },
    features: {
      registration: providerConfig.dynamicClientRegistration.enabled,
      // Always on: without it there is no way for a user to disconnect an app they granted access to,
      // and a consent screen you can't revoke is not really consent.
      revocation: true,
    },
    // OAuth 2.1 and the MCP authorization spec both require PKCE unconditionally.
    requirePkce: true,
    interactionUrl: (uid) => getProjectOAuthInteractionUrl(tenancy, uid),
    middleware: (oidc) => installProjectOAuthInteractionMiddleware(oidc, tenancy),
    routes: {
      // MCP authorization metadata and clients use /authorize; oidc-provider defaults to /auth.
      authorization: "/authorize",
      jwks: `/api/v1/projects/${tenancy.project.id}/oidc/.well-known/jwks.json`,
    },
  });
}
