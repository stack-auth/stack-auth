import {
  createProjectOAuthProvider,
  getProjectResourceServers,
  getProjectStaticClients,
} from "@/lib/project-oauth-provider";
import { getProject } from "@/lib/projects";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { handleApiRequest } from "@/route-handlers/smart-route-handler";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { createNodeHttpServerDuplex } from "@hexclave/shared/dist/utils/node-http";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const pathPrefix = "/api/v1/projects/";
const oidcPathSuffix = "/oidc";

function prefixOidcCookiePath(cookie: string, mountPath: string): string {
  return cookie.replace(/(;\s*path=)([^;]*)/i, (match, prefix: string, path: string) =>
    path.startsWith(mountPath)
      ? match
      : `${prefix}${mountPath}${path}`,
  );
}

function getProjectIdFromPath(pathname: string): string {
  if (!pathname.startsWith(pathPrefix) || !pathname.includes(oidcPathSuffix)) {
    throw new HexclaveAssertionError("No project OIDC path found in request URL.", { pathname });
  }

  const projectPath = pathname.slice(pathPrefix.length);
  const oidcPathIndex = projectPath.indexOf(oidcPathSuffix);
  if (oidcPathIndex <= 0) {
    throw new HexclaveAssertionError("No project ID found in request URL.", { pathname });
  }

  return projectPath.slice(0, oidcPathIndex);
}

async function getProjectProvider(projectId: string) {
  const project = await getProject(projectId);
  if (project === null) {
    throw new StatusError(404, "Not found");
  }

  // Browser redirects cannot carry the branch header used by ordinary API requests. Pinning the
  // provider to the default branch also ensures authorize and token requests resolve the same issuer.
  // getProjectIdpId already includes the branch, so independently addressable branch issuers remain
  // possible when multi-branch OAuth support is added.
  const tenancy = await getSoleTenancyFromProjectBranch(project, DEFAULT_BRANCH_ID, true);
  if (tenancy === null) {
    throw new StatusError(404, "Not found");
  }

  const resourceServers = getProjectResourceServers(tenancy);
  const staticClients = getProjectStaticClients(tenancy);
  if (resourceServers.size === 0 && staticClients.length === 0) {
    throw new StatusError(404, "Not found");
  }

  // Provider construction is intentionally per-request; memoize later if profiling shows it matters.
  return await createProjectOAuthProvider(tenancy, {
    apiUrl: getEnvVariable("NEXT_PUBLIC_STACK_API_URL"),
  });
}

const handler = handleApiRequest(async (req: NextRequest) => {
  const projectId = getProjectIdFromPath(req.nextUrl.pathname);
  const requestUrl = new URL(req.url);
  const oidcPath = requestUrl.pathname.slice(
    `${pathPrefix}${projectId}${oidcPathSuffix}`.length,
  ) || "/";
  // oidc-provider only serves discovery at openid-configuration; RFC 8414 and MCP require
  // oauth-authorization-server, so alias that exact pathname without rewriting query parameters.
  const aliasedPath =
    oidcPath === "/.well-known/oauth-authorization-server"
      ? "/.well-known/openid-configuration"
      : oidcPath;
  const oidcUrl = new URL(requestUrl);
  oidcUrl.pathname = aliasedPath;
  const newHeaders = new Headers(req.headers);
  const incomingBody = new Uint8Array(await req.arrayBuffer());
  const [incomingMessage, serverResponse] = await createNodeHttpServerDuplex({
    method: req.method,
    originalUrl: new URL(oidcUrl),
    url: new URL(oidcUrl),
    headers: newHeaders,
    body: incomingBody,
  });

  const oidc = await getProjectProvider(projectId);
  await oidc.callback()(incomingMessage, serverResponse);

  const body = new Uint8Array(serverResponse.bodyChunks.flatMap(chunk => [...chunk]));
  const headers: [string, string][] = [];
  const mountPath = `${pathPrefix}${projectId}${oidcPathSuffix}`;
  for (const [key, value] of Object.entries(serverResponse.getHeaders())) {
    if (key.toLowerCase() === "content-length") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.push([
          key,
          key.toLowerCase() === "set-cookie" ? prefixOidcCookiePath(item, mountPath) : item,
        ]);
      }
    } else {
      const stringValue = `${value}`;
      headers.push([
        key,
        key.toLowerCase() === "set-cookie"
          ? prefixOidcCookiePath(stringValue, mountPath)
          : stringValue,
      ]);
    }
  }

  return new NextResponse(body, {
    headers,
    status: {
      301: 308,
      302: 307,
    }[serverResponse.statusCode] ?? serverResponse.statusCode,
    statusText: serverResponse.statusMessage,
  });
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
