import { httpMethodNames } from "@/generated/route-modules";
import { serializeSetCookie } from "@/lib/runtime/headers";
import { NextNotFoundError } from "@/lib/runtime/navigation";
import { parseCookieHeader, requestContextALS, type RequestContext } from "@/lib/runtime/request-context";
import { node } from "@elysiajs/node";
import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { Elysia } from "elysia";
import { createBackendRequest } from "./backend-request";
import { handleUncaughtBackendError } from "./error-handler";
import { runRequestPipeline } from "./middleware";
import { MalformedRouteParamError, matchRoute } from "./registry";

const globalSecurityHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy": "",
};
const knownHttpMethods = new Set<string>(httpMethodNames);

export const app = new Elysia({
  adapter: node(),
})
  .onError(({ error }) => withGlobalHeaders(handleUncaughtBackendError(error)))
  .get("/", () => htmlResponse(homeHtml()))
  .get("/dev-stats", () => htmlResponse(devStatsHtml()))
  .get("/health/error-handler-debug", () => htmlResponse(errorHandlerDebugHtml()))
  .post("/monitoring", async ({ request }) => withGlobalHeaders(await handleMonitoringTunnel(request)), {
    parse: "none",
  })
  .all("/*", async ({ request }) => await dispatch(request), {
    parse: "none",
  });

export async function dispatch(request: Request) {
  const pipeline = await runRequestPipeline(request);
  if (pipeline.shortCircuitResponse != null) {
    return withGlobalHeaders(pipeline.shortCircuitResponse);
  }

  let match;
  try {
    match = matchRoute(pipeline.dispatchPath);
  } catch (error) {
    if (error instanceof MalformedRouteParamError) {
      return withGlobalHeaders(new Response("Bad Request", { status: 400 }));
    }
    throw error;
  }
  if (match == null) {
    return withGlobalHeaders(new Response("<div>404 Not Found</div>", {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    }));
  }

  const method = request.method.toUpperCase();
  if (!isHttpMethod(method)) {
    return withGlobalHeaders(new Response(null, {
      status: 405,
    }));
  }
  const handler = match.methods.get(method) ?? (method === "HEAD" ? match.methods.get("GET") : undefined);
  if (handler == null) {
    return withGlobalHeaders(new Response(null, {
      status: 405,
    }));
  }

  const backendRequest = createBackendRequest(request, pipeline.mergedHeaders, pipeline.originalUrl);
  const context: RequestContext = {
    headers: pipeline.mergedHeaders,
    incomingCookies: parseCookieHeader(pipeline.mergedHeaders.get("cookie")),
    pendingSetCookies: [],
    deletedCookies: [],
  };

  const response = await requestContextALS.run(context, async () => {
    try {
      return await handler(backendRequest, {
        params: Promise.resolve(match.params),
      });
    } catch (error) {
      if (isRedirectError(error)) {
        return new Response(null, {
          status: error.redirectStatus,
          headers: {
            Location: error.redirectUrl,
          },
        });
      }
      if (error instanceof NextNotFoundError) {
        return new Response("Not Found", { status: 404 });
      }
      throw error;
    }
  });

  const finalResponse = method === "HEAD" ? new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  }) : response;

  for (const cookie of context.pendingSetCookies) {
    finalResponse.headers.append("Set-Cookie", serializeSetCookie(cookie.name, cookie.value, cookie.options));
  }
  for (const cookie of context.deletedCookies) {
    finalResponse.headers.append("Set-Cookie", serializeSetCookie(cookie.name, cookie.value, cookie.options));
  }
  if (pipeline.corsHeadersInit != null) {
    for (const [key, value] of Object.entries(pipeline.corsHeadersInit)) {
      finalResponse.headers.set(key, value);
    }
  }
  if (pipeline.middlewareRewrite != null) {
    finalResponse.headers.set("x-middleware-rewrite", pipeline.middlewareRewrite);
  }
  return withGlobalHeaders(finalResponse);
}

function isRedirectError(error: unknown): error is { redirectStatus: 307 | 308, redirectUrl: string } {
  if (!(error instanceof Error) || !("digest" in error) || !("redirectUrl" in error) || !("redirectStatus" in error)) {
    return false;
  }
  return typeof error.digest === "string"
    && error.digest.startsWith("NEXT_REDIRECT")
    && typeof error.redirectUrl === "string"
    && (error.redirectStatus === 307 || error.redirectStatus === 308);
}

function withGlobalHeaders(response: Response) {
  for (const [key, value] of Object.entries(globalSecurityHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

function htmlResponse(body: string, status = 200) {
  return withGlobalHeaders(new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  }));
}

function homeHtml() {
  const devStatsLink = getNodeEnvironment() === "development"
    ? `<br><a href="/dev-stats">Dev Stats</a><br>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Hexclave API</title>
  </head>
  <body>
    <div>
      Welcome to Hexclave's API endpoint.<br>
      <br>
      Were you looking for <a href="https://app.hexclave.com">Hexclave's dashboard</a> instead?<br>
      <br>
      You can also return to <a href="https://hexclave.com">https://hexclave.com</a>.<br>
      <br>
      <a href="/api/v1">API v1</a><br>
      ${devStatsLink}
    </div>
  </body>
</html>`;
}

function devStatsHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Hexclave Backend Dev Stats</title>
    <style>
      body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 24px; }
      button { font: inherit; padding: 4px 8px; }
      pre { background: #f6f8fa; border: 1px solid #d0d7de; padding: 12px; overflow: auto; }
    </style>
  </head>
  <body>
    <h1>Dev Stats</h1>
    <button id="refresh">Refresh</button>
    <pre id="output">Loading...</pre>
    <script>
      async function refresh() {
        const output = document.getElementById("output");
        const response = await fetch("/dev-stats/api", { headers: { "accept": "application/json" } });
        output.textContent = JSON.stringify(await response.json(), null, 2);
      }
      document.getElementById("refresh").addEventListener("click", refresh);
      refresh();
    </script>
  </body>
</html>`;
}

function errorHandlerDebugHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Backend Error Debug</title>
  </head>
  <body>
    <div>
      This page is useful for testing error handling.<br>
      Your observability platform should pick up on the errors thrown below.<br>
      <button id="client-error">Throw client error</button>
      <button id="server-error">Throw server error</button>
    </div>
    <script>
      document.getElementById("client-error").addEventListener("click", () => {
        throw new Error("Client debug error thrown successfully!");
      });
      document.getElementById("server-error").addEventListener("click", () => {
        fetch("/health/error-handler-debug/endpoint").then((response) => console.log("Endpoint response", response));
      });
    </script>
  </body>
</html>`;
}

async function handleMonitoringTunnel(request: Request) {
  const allowedDsn = getEnvVariable("NEXT_PUBLIC_SENTRY_DSN", "");
  if (allowedDsn === "") {
    return new Response(null, { status: 404 });
  }

  const envelope = await request.text();
  const firstLineEnd = envelope.indexOf("\n");
  const envelopeHeaderBytes = firstLineEnd === -1 ? envelope : envelope.slice(0, firstLineEnd);
  const envelopeDsn = getEnvelopeDsn(envelopeHeaderBytes);
  if (envelopeDsn !== allowedDsn) {
    return new Response("Invalid Sentry envelope DSN", {
      status: 400,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const sentryDsnUrl = new URL(allowedDsn);
  const projectId = sentryDsnUrl.pathname.split("/").filter(Boolean).at(-1);
  if (projectId == null) {
    return new Response("Invalid configured Sentry DSN", {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const sentryEnvelopeUrl = new URL(`/api/${projectId}/envelope/`, sentryDsnUrl.origin);
  const sentryResponse = await fetch(sentryEnvelopeUrl, {
    method: "POST",
    body: envelope,
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/x-sentry-envelope",
    },
  });
  return new Response(sentryResponse.body, {
    status: sentryResponse.status,
    statusText: sentryResponse.statusText,
    headers: sentryResponse.headers,
  });
}

function getEnvelopeDsn(envelopeHeaderBytes: string) {
  let parsedEnvelopeHeader: unknown;
  try {
    parsedEnvelopeHeader = JSON.parse(envelopeHeaderBytes);
  } catch {
    return undefined;
  }
  if (
    parsedEnvelopeHeader == null
    || typeof parsedEnvelopeHeader !== "object"
    || !("dsn" in parsedEnvelopeHeader)
    || typeof parsedEnvelopeHeader.dsn !== "string"
  ) {
    return undefined;
  }
  return parsedEnvelopeHeader.dsn;
}

function isHttpMethod(method: string): method is typeof httpMethodNames[number] {
  return knownHttpMethods.has(method);
}
