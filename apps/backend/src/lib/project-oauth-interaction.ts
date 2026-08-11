import { getUser } from "@/app/api/latest/users/crud";
import { getProjectIdpId, getProjectOAuthIssuer, getProjectResourceServers, isTrustedClient } from "@/lib/project-oauth-provider";
import { deriveScopesFromConfig } from "@/lib/permissions";
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import type { Tenancy } from "@/lib/tenancies";
import { getHostedHandlerTrustedDomain } from "@/lib/redirect-urls";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError, captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import Provider from "oidc-provider";
import type { AccountClaims } from "oidc-provider";
import projectOAuthSessionMiddleware from "oidc-provider/lib/shared/session.js";
import projectOAuthProviderInstance from "oidc-provider/lib/helpers/weak_cache.js";

if (typeof projectOAuthSessionMiddleware !== "function") {
  throw new Error("Expected oidc-provider@8.5.1/lib/shared/session.js to export a session middleware function.");
}
if (typeof projectOAuthProviderInstance !== "function") {
  throw new Error("Expected oidc-provider@8.5.1/lib/helpers/weak_cache.js to export its provider instance accessor.");
}

const MODEL = "ProjectOAuthInteraction";
const TTL_SECONDS = 10 * 60;
const GRANT_TTL_SECONDS = 14 * 24 * 60 * 60;
const OIDC_SCOPES = new Set(["openid", "profile", "email", "phone", "address", "offline_access"]);

export type ProjectOAuthInteraction = {
  uid: string,
  projectId: string,
  idpId: string,
  clientId: string,
  requestedScopes: string[],
  resource?: string,
  userId?: string,
  approvedScopes?: string[],
  denied?: boolean,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInteraction(value: unknown): ProjectOAuthInteraction | undefined {
  if (!isRecord(value)) return undefined;
  const requestedScopes = value.requestedScopes;
  if (
    typeof value.uid !== "string"
    || typeof value.projectId !== "string"
    || typeof value.idpId !== "string"
    || typeof value.clientId !== "string"
    || !Array.isArray(requestedScopes)
    || requestedScopes.some(scope => typeof scope !== "string")
  ) return undefined;
  return {
    uid: value.uid,
    projectId: value.projectId,
    idpId: value.idpId,
    clientId: value.clientId,
    requestedScopes: requestedScopes.filter((scope): scope is string => typeof scope === "string"),
    ...(typeof value.resource === "string" ? { resource: value.resource } : {}),
    ...(typeof value.userId === "string" ? { userId: value.userId } : {}),
    ...(Array.isArray(value.approvedScopes) && value.approvedScopes.every(scope => typeof scope === "string")
      ? { approvedScopes: value.approvedScopes.filter((scope): scope is string => typeof scope === "string") }
      : {}),
    ...(typeof value.denied === "boolean" ? { denied: value.denied } : {}),
  };
}

function interactionId(tenancy: Tenancy, uid: string): string {
  return `${getProjectIdpId(tenancy)}:${uid}`;
}

async function readInteraction(tenancy: Tenancy, uid: string): Promise<ProjectOAuthInteraction | undefined> {
  const row = await globalPrismaClient.idPAdapterData.findUnique({
    where: {
      idpId_model_id: {
        idpId: getProjectIdpId(tenancy),
        model: MODEL,
        id: interactionId(tenancy, uid),
      },
    },
  });
  if (row === null || row.expiresAt <= new Date()) return undefined;
  const parsed = parseInteraction(row.payload);
  if (parsed === undefined) {
    captureError("project-oauth-invalid-interaction-payload", new HexclaveAssertionError("Invalid project OAuth interaction payload"));
  }
  return parsed;
}

export async function getProjectOAuthInteraction(tenancy: Tenancy, uid: string): Promise<ProjectOAuthInteraction | undefined> {
  return await readInteraction(tenancy, uid);
}

export async function recordProjectOAuthDecision(options: {
  tenancy: Tenancy,
  uid: string,
  userId: string,
  approvedScopes: string[],
  denied: boolean,
}): Promise<string> {
  const interaction = await readInteraction(options.tenancy, options.uid);
  if (interaction === undefined) throw new StatusError(400, "This authorization request has expired.");
  if (interaction.userId !== undefined && interaction.userId !== options.userId) {
    captureError("project-oauth-interaction-user-mismatch", new HexclaveAssertionError("Project OAuth decision user mismatch"));
    throw new StatusError(400, "This authorization request is not available for this user.");
  }

  validateApprovedScopes(options.tenancy, interaction, options.approvedScopes);

  await globalPrismaClient.idPAdapterData.update({
    where: {
      idpId_model_id: {
        idpId: getProjectIdpId(options.tenancy),
        model: MODEL,
        id: interactionId(options.tenancy, options.uid),
      },
    },
    data: {
      payload: {
        ...interaction,
        userId: options.userId,
        approvedScopes: options.approvedScopes,
        denied: options.denied,
      },
      expiresAt: new Date(Date.now() + TTL_SECONDS * 1000),
    },
  });
  const doneUrl = new URL(getProjectOAuthIssuer(options.tenancy.project.id, getEnvVariable("NEXT_PUBLIC_STACK_API_URL")));
  doneUrl.pathname = `${doneUrl.pathname.replace(/\/$/, "")}/interaction/${encodeURIComponent(options.uid)}/done`;
  return doneUrl.toString();
}

function validateApprovedScopes(
  tenancy: Tenancy,
  interaction: ProjectOAuthInteraction,
  approvedScopes: string[],
): void {
  const requested = new Set(interaction.requestedScopes);
  if (approvedScopes.some(scope => !requested.has(scope))) {
    throw new StatusError(400, "The selected permissions are not part of this authorization request.");
  }
  const defined = new Set(deriveScopesFromConfig(tenancy.config).map(scope => scope.scope));
  const allowed = interaction.resource === undefined
    ? undefined
    : new Set(getProjectResourceServers(tenancy).get(interaction.resource)?.scopes ?? []);
  if (approvedScopes.some(scope => !OIDC_SCOPES.has(scope) && (!defined.has(scope) || (allowed !== undefined && !allowed.has(scope))))) {
    throw new StatusError(400, "The selected permissions are not allowed for this resource.");
  }
}

export async function consumeProjectOAuthDecision(tenancy: Tenancy, uid: string): Promise<ProjectOAuthInteraction> {
  return await retryTransaction(globalPrismaClient, async (tx) => {
    const row = await tx.idPAdapterData.findUnique({
      where: {
        idpId_model_id: {
          idpId: getProjectIdpId(tenancy),
          model: MODEL,
          id: interactionId(tenancy, uid),
        },
      },
    });
    if (row === null || row.expiresAt <= new Date()) throw new StatusError(400, "This authorization request has expired.");
    const interaction = parseInteraction(row.payload);
    if (
      interaction === undefined
      || interaction.userId === undefined
      || interaction.approvedScopes === undefined
      || interaction.denied === undefined
    ) {
      captureError("project-oauth-invalid-decision", new HexclaveAssertionError("Project OAuth decision was invalid or already used"));
      throw new StatusError(400, "This authorization request is no longer available.");
    }
    await tx.idPAdapterData.delete({
      where: {
        idpId_model_id: {
          idpId: getProjectIdpId(tenancy),
          model: MODEL,
          id: interactionId(tenancy, uid),
        },
      },
    });
    return interaction;
  });
}

export function installProjectOAuthInteractionMiddleware(oidc: Provider, tenancy: Tenancy): void {
  oidc.use(async (ctx, next) => {
    const doneMatch = /^\/interaction\/([^/]+)\/done$/.exec(ctx.path);
    if (doneMatch !== null && (ctx.method === "GET" || ctx.method === "POST")) {
      const uid = doneMatch[1];
      const decision = await getProjectOAuthInteraction(tenancy, uid);
      if (decision === undefined) {
        throw new StatusError(400, "This authorization request has expired.");
      }
      const interaction = await oidc.Interaction.find(uid);
      if (interaction === undefined) {
        throw new StatusError(400, "This authorization request is no longer available.");
      }
      const clientId = typeof interaction.params.client_id === "string"
        ? interaction.params.client_id
        : throwErr("Project OAuth client ID was missing");
      if (decision.uid !== uid || decision.clientId !== clientId) {
        captureError("project-oauth-interaction-context-mismatch", new HexclaveAssertionError("Project OAuth interaction context mismatch"));
        throw new StatusError(400, "This authorization request is no longer available.");
      }
      const userId = decision.userId ?? throwErr("Project OAuth decision user ID was missing");
      if (interaction.session?.accountId !== undefined && interaction.session.accountId !== userId) {
        captureError("project-oauth-provider-session-user-mismatch", new HexclaveAssertionError("Project OAuth provider session user mismatch"));
        throw new StatusError(400, "This authorization request is not available for this user.");
      }

      const finish = async () => {
        const session = ctx.oidc.session;
        if (session.accountId !== undefined && session.accountId !== userId) {
          captureError("project-oauth-provider-session-user-mismatch", new HexclaveAssertionError("Project OAuth provider session user mismatch"));
          throw new StatusError(400, "This authorization request is not available for this user.");
        }
        // Hosted authentication is authoritative for this interaction, while oidc-provider checks
        // the provider session UID before applying result.login. Bind both to the same user first
        // so stale provider cookies cannot select a different session or bypass that check.
        session.loginAccount({ accountId: userId });
        session.touched = true;
        interaction.session = {
          accountId: userId,
          uid: session.uid,
          cookie: session.jti,
        };
        // interactionFinished validates the bound session immediately, before the surrounding
        // session middleware's finally block can persist a newly established session. Use the
        // provider's configured session TTL here, matching oidc-provider's own middleware, rather
        // than shortening SSO to the interaction's remaining lifetime.
        // oidc-provider's public Session API accepts the TTL but does not expose configured TTLs.
        // Read the same internal configuration hook used by its pinned session middleware. This
        // private import is pinned to 8.5.1; if it moves, session persistence must fail loudly
        // rather than silently shortening or extending SSO.
        const sessionTtl = projectOAuthProviderInstance(oidc).configuration("ttl.Session");
        const sessionTtlSeconds = typeof sessionTtl === "function"
          ? sessionTtl(ctx, session)
          : sessionTtl;
        if (typeof sessionTtlSeconds !== "number" || sessionTtlSeconds <= 0) {
          throw new Error("Expected oidc-provider@8.5.1 ttl.Session to resolve to a positive number.");
        }
        await session.save(sessionTtlSeconds);
        session.touched = true;
        await interaction.save(Math.max(1, interaction.exp - Math.floor(Date.now() / 1000)));
        const cookieInteraction = await oidc.interactionDetails(ctx.req, ctx.res);
        if (cookieInteraction.uid !== uid) {
          captureError("project-oauth-interaction-cookie-mismatch", new HexclaveAssertionError("Project OAuth interaction cookie mismatch"));
          throw new StatusError(400, "This authorization request is no longer available.");
        }

        const consumed = await consumeProjectOAuthDecision(tenancy, uid);
        if (consumed.denied) {
          return await oidc.interactionFinished(ctx.req, ctx.res, { error: "access_denied" });
        }

        const approved = consumed.approvedScopes;
        if (approved === undefined) {
          captureError("project-oauth-grant-scope-mismatch", new HexclaveAssertionError("Project OAuth grant scope mismatch"));
          throw new StatusError(400, "This authorization request is no longer valid.");
        }
        validateApprovedScopes(tenancy, consumed, approved);
        const grant = new oidc.Grant({ accountId: userId, clientId });
        const oidcScopes = approved.filter(scope => OIDC_SCOPES.has(scope));
        // oidc-provider treats every configured `scopes` entry as an OP scope for consent
        // bookkeeping, including resource scopes. Keep the complete approved set on the grant so
        // its `op_scopes_missing` check sees the consent as satisfied; resource authorization is
        // separately represented below and remains enforced by the resource server.
        if (approved.length > 0) grant.addOIDCScope(approved.join(" "));
        if (consumed.resource !== undefined) {
          grant.addResourceScope(consumed.resource, approved.filter(scope => !oidcScopes.includes(scope)).join(" "));
        }
        // oidc-provider's default refresh-token lifetime is 14 days. Keep the consent grant alive
        // for the same period so offline_access does not silently outlive its backing grant.
        const grantId = await grant.save(GRANT_TTL_SECONDS);
        return await oidc.interactionFinished(
          ctx.req,
          ctx.res,
          { login: { accountId: userId }, consent: { grantId } },
          { mergeWithLastSubmission: false },
        );
      };

      if (ctx.oidc === undefined) {
        Object.defineProperty(ctx, "oidc", { value: new oidc.OIDCContext(ctx) });
      }
      if (ctx.oidc.session === undefined) {
        return await projectOAuthSessionMiddleware(ctx, finish);
      }
      return await finish();
    }
    const match = /^\/interaction\/([^/]+)$/.exec(ctx.path);
    if (match !== null && ctx.method === "GET") {
      // oidc-provider does not register its built-in /interaction route when devInteractions is
      // disabled, so this custom route runs before the provider's context/session middleware.
      // Initialize the same public OIDCContext shape before invoking the pinned session middleware;
      // if oidc-provider moves that internal middleware, the module-load assertion above fails
      // loudly instead of silently losing the provider session again.
      if (ctx.oidc === undefined) {
        Object.defineProperty(ctx, "oidc", { value: new oidc.OIDCContext(ctx) });
      }
      return await projectOAuthSessionMiddleware(ctx, async () => {
        const uid = match[1];
        const details = await oidc.interactionDetails(ctx.req, ctx.res);
        // A signed-out authorization starts with a new, unpersisted oidc-provider session. The
        // hosted sign-in happens on another origin, so persist it here before leaving the provider
        // origin; otherwise resume creates a different session and rejects the interaction.
        ctx.oidc.session.touched = true;
        const issuer = new URL(getProjectOAuthIssuer(tenancy.project.id, getEnvVariable("NEXT_PUBLIC_STACK_API_URL")));
        const returnTo = new URL(details.returnTo, issuer);
        if (returnTo.origin === issuer.origin && !returnTo.pathname.startsWith(issuer.pathname)) {
          // The provider computes its resume URL from the request mount. The Next adapter dispatches
          // through a stripped internal path, so persist the canonical issuer prefix before the
          // browser leaves this origin; otherwise the final resume navigation would hit /auth/:uid.
          returnTo.pathname = `${issuer.pathname.replace(/\/$/, "")}${returnTo.pathname}`;
          details.returnTo = returnTo.toString();
          await details.save(Math.max(1, details.exp - Math.floor(Date.now() / 1000)));
        }
        const clientId = typeof details.params.client_id === "string" ? details.params.client_id : throwErr("Project OAuth client ID was missing");
        const resource = typeof details.params.resource === "string" ? details.params.resource : undefined;
        const requestedScopes = `${details.params.scope ?? ""}`.split(" ").filter(Boolean);
        await globalPrismaClient.idPAdapterData.upsert({
          where: { idpId_model_id: { idpId: getProjectIdpId(tenancy), model: MODEL, id: interactionId(tenancy, uid) } },
          create: {
            idpId: getProjectIdpId(tenancy),
            model: MODEL,
            id: interactionId(tenancy, uid),
            payload: {
              uid,
              projectId: tenancy.project.id,
              idpId: getProjectIdpId(tenancy),
              clientId,
              requestedScopes,
              ...(resource === undefined ? {} : { resource }),
            },
            expiresAt: new Date(Date.now() + TTL_SECONDS * 1000),
          },
          update: {},
        });
        // A project without required consent still requires an authenticated account. This removes
        // the confirmation click without weakening scope/resource authority checks.
        if (!projectOAuthClientNeedsInteraction(tenancy, clientId)
          && typeof details.session?.accountId === "string") {
          const doneUrl = await recordProjectOAuthDecision({
            tenancy,
            uid,
            userId: details.session.accountId,
            approvedScopes: requestedScopes,
            denied: false,
          });
          return ctx.redirect(doneUrl);
        }
        const interactionUrl = new URL("/handler/oauth-provider-interaction", getHostedHandlerTrustedDomain(tenancy.project.id));
        interactionUrl.searchParams.set("interaction_uid", uid);
        return ctx.redirect(interactionUrl.toString());
      });
    }
    return await next();
  });
}

export async function findProjectOAuthAccount(tenancy: Tenancy, sub: string) {
  const user = await getUser({ tenancy, userId: sub });
  if (user === null) return undefined;
  return {
    accountId: sub,
    async claims(use: string, scope: string): Promise<AccountClaims> {
      const claims: AccountClaims = { sub };
      const scopes = new Set(scope.split(" "));
      if (scopes.has("profile")) {
        if (user.display_name !== null) claims.name = user.display_name;
        if (user.profile_image_url !== null) claims.picture = user.profile_image_url;
      }
      if (scopes.has("email") && user.primary_email !== null) {
        claims.email = user.primary_email;
        claims.email_verified = user.primary_email_verified;
      }
      return claims;
    },
  };
}

export function projectOAuthClientNeedsInteraction(tenancy: Tenancy, clientId: string): boolean {
  return tenancy.config.oauthProvider.consent.required && !isTrustedClient(tenancy, clientId);
}
