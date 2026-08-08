import { getUser } from "@/app/api/latest/users/crud";
import { getProjectIdpId, getProjectOAuthIssuer, getProjectResourceServers, isTrustedClient } from "@/lib/project-oauth-provider";
import { deriveScopesFromConfig } from "@/lib/permissions";
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import type { Tenancy } from "@/lib/tenancies";
import { getHostedHandlerTrustedDomain } from "@/lib/redirect-urls";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError, captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import Provider from "oidc-provider";
import type { AccountClaims } from "oidc-provider";

const MODEL = "ProjectOAuthInteraction";
const TTL_SECONDS = 10 * 60;

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

  const requested = new Set(interaction.requestedScopes);
  if (options.approvedScopes.some(scope => !requested.has(scope))) {
    throw new StatusError(400, "The selected permissions are not part of this authorization request.");
  }

  const allowed = interaction.resource === undefined
    ? new Set(Object.keys(Object.fromEntries(getProjectResourceServers(options.tenancy))))
    : new Set(getProjectResourceServers(options.tenancy).get(interaction.resource)?.scopes ?? []);
  const defined = new Set(deriveScopesFromConfig(options.tenancy.config).map(scope => scope.scope));
  if (options.approvedScopes.some(scope => !defined.has(scope) || (interaction.resource !== undefined && !allowed.has(scope)))) {
    throw new StatusError(400, "The selected permissions are not allowed for this resource.");
  }

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
  return urlString`${getProjectOAuthIssuer(options.tenancy.project.id, getEnvVariable("NEXT_PUBLIC_STACK_API_URL"))}/interaction/${encodeURIComponent(options.uid)}/done`;
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
    if (doneMatch !== null && ctx.method === "GET") {
      ctx.status = 200;
      ctx.type = "text/html";
      ctx.body = "<html><body><form method=\"POST\"><button type=\"submit\">Continue</button></form><script>document.forms[0].submit()</script></body></html>";
      return;
    }
    if (doneMatch !== null && ctx.method === "POST") {
      const uid = doneMatch[1];
      const details = await oidc.interactionDetails(ctx.req, ctx.res);
      const decision = await consumeProjectOAuthDecision(tenancy, uid);
      if (decision.uid !== uid || decision.clientId !== details.params.client_id) {
        captureError("project-oauth-interaction-context-mismatch", new HexclaveAssertionError("Project OAuth interaction context mismatch"));
        throw new StatusError(400, "This authorization request is no longer available.");
      }
      if (decision.denied) return await oidc.interactionFinished(ctx.req, ctx.res, { error: "access_denied" });

      const resourceServers = getProjectResourceServers(tenancy);
      const allowed = decision.resource === undefined ? undefined : resourceServers.get(decision.resource);
      const definedScopes = new Set(deriveScopesFromConfig(tenancy.config).map(scope => scope.scope));
      const approved = decision.approvedScopes;
      if (approved === undefined || approved.some(scope => !definedScopes.has(scope) || (allowed !== undefined && !allowed.scopes.includes(scope)))) {
        captureError("project-oauth-grant-scope-mismatch", new HexclaveAssertionError("Project OAuth grant scope mismatch"));
        throw new StatusError(400, "This authorization request is no longer valid.");
      }
      const clientId = typeof details.params.client_id === "string" ? details.params.client_id : throwErr("Project OAuth client ID was missing");
      const userId = decision.userId ?? throwErr("Project OAuth decision user ID was missing");
      const grant = new oidc.Grant({ accountId: userId, clientId });
      const oidcScopes = approved.filter(scope => ["openid", "profile", "email", "phone", "address", "offline_access"].includes(scope));
      if (oidcScopes.length > 0) grant.addOIDCScope(oidcScopes.join(" "));
      if (decision.resource !== undefined) grant.addResourceScope(decision.resource, approved.filter(scope => !oidcScopes.includes(scope)).join(" "));
      const grantId = await grant.save(60 * 60);
      return await oidc.interactionFinished(ctx.req, ctx.res, { login: { accountId: userId }, consent: { grantId } });
    }
    const match = /^\/interaction\/([^/]+)$/.exec(ctx.path);
    if (match !== null && ctx.method === "GET") {
      const uid = match[1];
      const details = await oidc.interactionDetails(ctx.req, ctx.res);
      const clientId = typeof details.params.client_id === "string" ? details.params.client_id : throwErr("Project OAuth client ID was missing");
      const resource = typeof details.params.resource === "string" ? details.params.resource : undefined;
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
            requestedScopes: `${details.params.scope ?? ""}`.split(" ").filter(Boolean),
            ...(resource === undefined ? {} : { resource }),
          },
          expiresAt: new Date(Date.now() + TTL_SECONDS * 1000),
        },
        update: {},
      });
      const interactionUrl = new URL("/handler/oauth-provider-interaction", getHostedHandlerTrustedDomain(tenancy.project.id));
      interactionUrl.searchParams.set("interaction_uid", uid);
      return ctx.redirect(interactionUrl.toString());
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
  return !isTrustedClient(tenancy, clientId);
}
