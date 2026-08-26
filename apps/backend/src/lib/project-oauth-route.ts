import { getProjectOAuthProviderUrl } from "@/lib/project-oauth-provider";
import { getProjectOAuthProvider } from "@/lib/project-oauth-provider-cache";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { dispatchToNodeHttpHandler } from "@hexclave/shared/dist/utils/node-http";
const issuerPathPattern = /^\/api\/v1\/projects\/([^/]+)\/oidc(?:\/|$)/;
export const projectOAuthPathInsertionPattern = /^\/\.well-known\/(openid-configuration|oauth-authorization-server)\/api\/v1\/projects\/([^/]+)\/oidc$/;
export function isProjectOAuthPathInsertion(pathname: string): boolean {
  return projectOAuthPathInsertionPattern.test(pathname);
}

function getRouteDetails(pathname: string): {
  projectId: string,
  providerPath: string,
} {
  const issuerMatch = issuerPathPattern.exec(pathname);
  if (issuerMatch !== null) {
    const [, encodedProjectId] = issuerMatch;
    const projectId = decodeURIComponent(encodedProjectId);
    const issuerPath = pathname.slice(issuerMatch[0].length - (issuerMatch[0].endsWith("/") ? 1 : 0));
    const providerPath = issuerPath === "" ? "/" : issuerPath;
    return {
      projectId,
      providerPath: providerPath === "/.well-known/oauth-authorization-server"
        ? "/.well-known/openid-configuration"
        : providerPath,
    };
  }

  const pathInsertionMatch = projectOAuthPathInsertionPattern.exec(pathname);
  if (pathInsertionMatch !== null) {
    const [, metadataRoute, encodedProjectId] = pathInsertionMatch;
    return {
      projectId: decodeURIComponent(encodedProjectId),
      providerPath: metadataRoute === "oauth-authorization-server"
        ? "/.well-known/openid-configuration"
        : `/.well-known/${metadataRoute}`,
    };
  }

  throw new StatusError(404, "Project OAuth provider route not found");
}

export async function handleProjectOAuthRequest(req: Request): Promise<Response> {
  const requestUrl = new URL(req.url);
  const { projectId, providerPath } = getRouteDetails(requestUrl.pathname);

  // MCP clients (Claude Code among them) send scope-less authorization requests — plain OAuth with
  // only an RFC 8707 `resource`. oidc-provider hard-denies any authorization that resolves with no
  // granted scopes ("no scope was granted" in actions/authorization/interactions.js), and granted
  // scopes are always filtered against the *requested* scope param, so no consent-side grant can
  // rescue a scope-less request; the fix oidc-provider's own comment points to is the AS policy
  // injecting a default. Inject the minimal `openid` scope here — the consent handler then grants
  // it; the only cost is an (ignored) id_token in the client's token response. This must happen at
  // the adapter layer, BEFORE originalUrl/internalUrl are derived below: oidc-provider detects its
  // mount prefix via `req.originalUrl.indexOf(request.url)`, so the two must stay byte-identical in
  // their shared suffix or every derived URL (including the RFC-critical `_interaction_resume`
  // cookie path) silently falls back to the internal, unmounted path.
  if (providerPath === "/auth" && req.method === "GET" && (requestUrl.searchParams.get("scope") ?? "") === "") {
    requestUrl.searchParams.set("scope", "openid");
  }
  const tenancy = await getSoleTenancyFromProjectBranch(projectId, DEFAULT_BRANCH_ID, true);
  if (tenancy === null) {
    throw new StatusError(404, "Project not found");
  }

  const oidc = await getProjectOAuthProvider(tenancy, {
    apiUrl: getEnvVariable("NEXT_PUBLIC_STACK_API_URL"),
  });

  // oidc-provider derives absolute endpoint URLs from the mount prefix between originalUrl and
  // request.url. For origin-root aliases, retain the canonical issuer prefix in originalUrl while
  // dispatching the provider against the rewritten route path.
  const originalUrl = new URL(getProjectOAuthProviderUrl(
    projectId,
    providerPath === "/" ? "" : providerPath,
    getEnvVariable("NEXT_PUBLIC_STACK_API_URL"),
  ));
  originalUrl.search = requestUrl.search;
  const internalUrl = new URL(requestUrl);
  internalUrl.pathname = providerPath;
  return await dispatchToNodeHttpHandler(oidc.callback(), {
    method: req.method,
    originalUrl,
    url: internalUrl,
    headers: new Headers(req.headers),
    body: new Uint8Array(await req.arrayBuffer()),
  });
}
