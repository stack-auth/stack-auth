import { handleApiRequest } from "@/route-handlers/smart-route-handler";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { createNodeHttpServerDuplex } from "@stackframe/stack-shared/dist/utils/node-http";
import { NextRequest, NextResponse } from "next/server";
import { createOidcProvider } from "../../../../idp";

export const dynamic = "force-dynamic";

const pathPrefix = "/api/v1/integrations/custom/oauth/idp";

// we want to initialize the OIDC provider lazily so it's not initiated at build time
let _oidcCallbackPromiseCache: Promise<any> | undefined;
function getOidcCallbackPromise() {
  if (!_oidcCallbackPromiseCache) {
    const apiBaseUrl = new URL(getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
    const idpBaseUrl = new URL(pathPrefix, apiBaseUrl);
    _oidcCallbackPromiseCache = (async () => {
      const oidc = await createOidcProvider({
        id: "stack-preconfigured-idp:integrations/custom",
        baseUrl: idpBaseUrl.toString(),
        clientInteractionUrl: new URL(`/integrations/custom/confirm`, getEnvVariable("NEXT_PUBLIC_STACK_DASHBOARD_URL")).toString(),
      });
      return oidc.callback();
    })();
  }
  return _oidcCallbackPromiseCache;
}

const handler = handleApiRequest(async (req: NextRequest) => {
  const newUrl = req.url.replace(pathPrefix, "");
  if (newUrl === req.url) {
    throw new StackAssertionError("No path prefix found in request URL. Is the pathPrefix correct?", { newUrl, url: req.url, pathPrefix });
  }
  const newHeaders = new Headers(req.headers);
  const incomingBody = new Uint8Array(await req.arrayBuffer());
  const [incomingMessage, serverResponse] = await createNodeHttpServerDuplex({
    method: req.method,
    originalUrl: new URL(req.url),
    url: new URL(newUrl),
    headers: newHeaders,
    body: incomingBody,
  });

  await (await getOidcCallbackPromise())(incomingMessage, serverResponse);

  const body = new Uint8Array(serverResponse.bodyChunks.flatMap(chunk => [...chunk]));

  let headers: [string, string][] = [];
  for (const [k, v] of Object.entries(serverResponse.getHeaders())) {
    if (Array.isArray(v)) {
      for (const vv of v) {
        headers.push([k, vv]);
      }
    } else {
      headers.push([k, `${v}`]);
    }
  }

  // filter out session cookies; we don't want to keep sessions open, every OAuth flow should start a new session
  headers = headers.filter(([k, v]) => k !== "set-cookie" || !v.toString().match(/^_session\.?/));

  return new NextResponse(body, {
    headers: headers,
    status: {
      // our API never returns 301 or 302 by convention, so transform them to 307 or 308
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
