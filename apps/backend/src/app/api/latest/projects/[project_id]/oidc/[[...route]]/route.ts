import { getHostedHandlerTrustedDomain } from "@/lib/redirect-urls";
import { getProjectOAuthProvider } from "@/lib/project-oauth-provider-cache";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { handleApiRequest } from "@/route-handlers/smart-route-handler";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { createNodeHttpServerDuplex } from "@hexclave/shared/dist/utils/node-http";
import { urlString } from "@hexclave/shared/dist/utils/urls";

export const dynamic = "force-dynamic";

const pathPrefixPattern = /^\/api\/v1\/projects\/([^/]+)\/oidc(?:\/|$)/;

const handler = handleApiRequest(async (req: Request) => {
  const requestUrl = new URL(req.url);
  const projectId = decodeURIComponent(
    pathPrefixPattern.exec(requestUrl.pathname)?.[1] ?? throwErr("Project OAuth provider route did not match its expected path"),
  );
  const tenancy = await getSoleTenancyFromProjectBranch(projectId, DEFAULT_BRANCH_ID, true);
  if (tenancy === null) {
    throw new StatusError(404, "Project not found");
  }

  // The public issuer has no branch segment, so it serves only the default branch. The provider
  // idpId remains branch-scoped because grants and signing keys are persisted per branch.
  const interactionBaseUrl = new URL(
    "/handler/oauth-provider-interaction",
    getHostedHandlerTrustedDomain(projectId),
  );
  const apiBaseUrl = getEnvVariable("NEXT_PUBLIC_STACK_API_URL");
  const oidc = await getProjectOAuthProvider(tenancy, {
    apiUrl: apiBaseUrl,
    interactionUrl: (interactionUid) => {
      const interactionUrl = new URL(interactionBaseUrl);
      interactionUrl.searchParams.set("interaction_uid", interactionUid);
      return interactionUrl.toString();
    },
  });

  const pathPrefix = urlString`/api/v1/projects/${projectId}/oidc`;
  const newUrl = req.url.replace(pathPrefix, "");
  if (newUrl === req.url) {
    throw new HexclaveAssertionError("No path prefix found in project OAuth provider request URL");
  }
  const [incomingMessage, serverResponse] = await createNodeHttpServerDuplex({
    method: req.method,
    originalUrl: requestUrl,
    url: new URL(newUrl),
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
  headers = headers.filter(([key, value]) => key !== "set-cookie" || !value.toString().match(/^_session\.?/));

  return new Response(body, {
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
