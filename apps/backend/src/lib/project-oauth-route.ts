import { getProjectOAuthIssuer } from "@/lib/project-oauth-provider";
import { getProjectOAuthProvider } from "@/lib/project-oauth-provider-cache";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { createNodeHttpServerDuplex } from "@hexclave/shared/dist/utils/node-http";
const issuerPathPattern = /^\/api\/v1\/projects\/([^/]+)\/oidc(?:\/|$)/;
const pathInsertionPattern = /^\/\.well-known\/(openid-configuration|oauth-authorization-server)\/api\/v1\/projects\/([^/]+)\/oidc$/;

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

  const pathInsertionMatch = pathInsertionPattern.exec(pathname);
  if (pathInsertionMatch !== null) {
    const [, metadataRoute, encodedProjectId] = pathInsertionMatch;
    return {
      projectId: decodeURIComponent(encodedProjectId),
      providerPath: metadataRoute === "oauth-authorization-server"
        ? "/.well-known/openid-configuration"
        : `/.well-known/${metadataRoute}`,
    };
  }

  throw new HexclaveAssertionError("Project OAuth provider route did not match its expected path");
}

export async function handleProjectOAuthRequest(req: Request): Promise<Response> {
  const requestUrl = new URL(req.url);
  const { projectId, providerPath } = getRouteDetails(requestUrl.pathname);
  const tenancy = await getSoleTenancyFromProjectBranch(projectId, DEFAULT_BRANCH_ID, true);
  if (tenancy === null) {
    throw new StatusError(404, "Project not found");
  }

  // The public issuer has no branch segment, so it serves only the default branch. The provider
  // idpId remains branch-scoped because grants and signing keys are persisted per branch.
  const oidc = await getProjectOAuthProvider(tenancy, {
    apiUrl: getEnvVariable("NEXT_PUBLIC_STACK_API_URL"),
  });

  const issuerUrl = new URL(
    getProjectOAuthIssuer(projectId, getEnvVariable("NEXT_PUBLIC_STACK_API_URL")),
  );
  // oidc-provider derives absolute endpoint URLs from the mount prefix between originalUrl and
  // request.url. For origin-root aliases, retain the canonical issuer prefix in originalUrl while
  // dispatching the provider against the rewritten route path.
  const originalUrl = new URL(issuerUrl);
  originalUrl.pathname = `${issuerUrl.pathname}${providerPath === "/" ? "" : providerPath}`;
  originalUrl.search = requestUrl.search;
  const internalUrl = new URL(requestUrl);
  internalUrl.pathname = providerPath;
  const [incomingMessage, serverResponse] = await createNodeHttpServerDuplex({
    method: req.method,
    originalUrl,
    url: internalUrl,
    headers: new Headers(req.headers),
    body: new Uint8Array(await req.arrayBuffer()),
  });

  await oidc.callback()(incomingMessage, serverResponse);

  const body = new Uint8Array(serverResponse.bodyChunks.flatMap(chunk => [...chunk]));
  let headers: [string, string][] = [];
  for (const [key, value] of Object.entries(serverResponse.getHeaders())) {
    if (Array.isArray(value)) {
      for (const item of value) headers.push([key, item]);
    } else {
      headers.push([key, `${value}`]);
    }
  }
  return new Response(body, {
    headers,
    status: {
      301: 308,
      302: 307,
    }[serverResponse.statusCode] ?? serverResponse.statusCode,
    statusText: serverResponse.statusMessage,
  });
}
