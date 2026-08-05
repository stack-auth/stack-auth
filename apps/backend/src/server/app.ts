import { httpMethodNames } from "@/generated/route-modules";
import { serializeSetCookie } from "@/lib/runtime/headers";
import { parseCookieHeader, requestContextALS, type RequestContext } from "@/lib/runtime/request-context";
import { node } from "@elysia/node";
import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { trace } from "@opentelemetry/api";
import { Elysia } from "elysia";
import { createBackendRequest } from "./backend-request";
import { compressResponse } from "./compression";
import { withVercelCronMonitor } from "./cron-monitor";
import { handleUncaughtBackendError } from "./error-handler";
import { getCorsHeadersInit, runRequestPipeline } from "./middleware";
import { createRequestCompletionLog } from "./request-log";
import { MalformedRouteParamError, matchRoute, type RouteMethods } from "./registry";
import { createRequestLifetime } from "./request-lifetime";

const globalSecurityHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy": "",
};
const knownHttpMethods = new Set<string>(httpMethodNames);
const requestStartTimes = new WeakMap<Request, number>();
const requestLogPaths = new WeakMap<Request, string>();
const staticRequestLogPaths = new Set([
  "/",
  "/dev-stats",
  "/health/error-handler-debug",
  "/health/error-handler-debug/endpoint",
]);
const shouldLogDevelopmentRequests = getNodeEnvironment() === "development";

export const app = new Elysia({
  adapter: node(),
})
  .onRequest(({ request }) => {
    requestStartTimes.set(request, performance.now());
    const pathname = new URL(request.url).pathname;
    requestLogPaths.set(request, staticRequestLogPaths.has(pathname) ? pathname : "<unmatched>");
  })
  .mapResponse(({ request, responseValue }) => responseValue instanceof Response
    ? compressResponse(request, responseValue)
    : undefined)
  .onAfterResponse(({ request, response, set }) => {
    const startedAt = requestStartTimes.get(request);
    if (shouldLogDevelopmentRequests) {
      const elapsedMilliseconds = startedAt == null ? "unknown" : (performance.now() - startedAt).toFixed(1);
      const pathname = new URL(request.url).pathname;
      console.log(`[Elysia] ${request.method} ${pathname} ${getLoggedResponseStatus(response, set.status)} ${elapsedMilliseconds}ms`);
      return;
    }

    const event = createRequestCompletionLog({
      request,
      response,
      fallbackStatus: set.status,
      startedAt,
      normalizedPath: requestLogPaths.get(request) ?? "<unknown>",
    });
    const serializedEvent = JSON.stringify(event);
    const status = typeof event.status === "number" ? event.status : Number(event.status);
    if (Number.isFinite(status) && status >= 500) {
      console.error(serializedEvent);
    } else {
      console.log(serializedEvent);
    }
  })
  .onError(({ error, request }) => withResponseHeaders(handleUncaughtBackendError(error), getCorsHeadersInit(request)))
  .get("/", () => htmlResponse(homeHtml()))
  .get("/dev-stats", () => getNodeEnvironment() === "development"
    ? htmlResponse(devStatsHtml())
    : htmlResponse("<div>404 Not Found</div>", 404))
  .get("/health/error-handler-debug", () => isObservabilityDebugRouteAvailable()
    ? htmlResponse(errorHandlerDebugHtml())
    : htmlResponse("<div>404 Not Found</div>", 404))
  .get("/health/error-handler-debug/endpoint", () => {
    if (!isObservabilityDebugRouteAvailable()) {
      return htmlResponse("<div>404 Not Found</div>", 404);
    }
    throw new Error("Server observability debug error thrown successfully!");
  })
  .all("/*", async ({ request }) => await dispatch(request), {
    parse: "none",
  });

async function dispatch(request: Request) {
  const pipeline = await runRequestPipeline(request);
  if (pipeline.shortCircuitResponse != null) {
    return withResponseHeaders(pipeline.shortCircuitResponse, pipeline.corsHeadersInit);
  }

  let match;
  try {
    match = matchRoute(pipeline.dispatchPath);
  } catch (error) {
    if (error instanceof MalformedRouteParamError) {
      return withResponseHeaders(new Response("Bad Request", { status: 400 }), pipeline.corsHeadersInit);
    }
    throw error;
  }
  if (match == null) {
    return withResponseHeaders(new Response("<div>404 Not Found</div>", {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    }), pipeline.corsHeadersInit);
  }
  requestLogPaths.set(request, match.normalizedPath);

  const method = request.method.toUpperCase();
  // Sentry's Node HTTP integration owns the incoming request span. Elysia is not
  // one of Sentry's framework integrations, so attach the matched route pattern
  // here instead of registering a second OpenTelemetry provider through Elysia's
  // plugin. The normalized path is safe; the concrete path may contain customer IDs.
  const requestSpan = trace.getActiveSpan();
  requestSpan?.updateName(`${method} ${match.normalizedPath}`);
  requestSpan?.setAttribute("http.request.method", method);
  requestSpan?.setAttribute("http.route", match.normalizedPath);
  const lifetime = createRequestLifetime({
    maxDurationSeconds: match.maxDurationSeconds,
    normalizedPath: match.normalizedPath,
    startedAt: requestStartTimes.get(request) ?? performance.now(),
  });
  const context: RequestContext = {
    headers: pipeline.mergedHeaders,
    incomingCookies: parseCookieHeader(pipeline.mergedHeaders.get("cookie")),
    pendingSetCookies: [],
    deletedCookies: [],
    lifetime,
    normalizedPath: match.normalizedPath,
  };

  return await requestContextALS.run(context, async () => await lifetime.runHandler(async (timeoutSignal) => {
    const methods = await match.loadMethods();
    if (!isHttpMethod(method)) {
      return withResponseHeaders(createMethodNotAllowedResponse(methods), pipeline.corsHeadersInit);
    }
    const handler = methods.get(method) ?? (method === "HEAD" ? methods.get("GET") : undefined);
    if (handler == null) {
      return withResponseHeaders(createMethodNotAllowedResponse(methods), pipeline.corsHeadersInit);
    }

    const backendRequest = createBackendRequest(
      request,
      pipeline.mergedHeaders,
      pipeline.originalUrl,
      AbortSignal.any([request.signal, timeoutSignal]),
    );
    const response = await withVercelCronMonitor(request, match.normalizedPath, async () => {
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
        throw error;
      }
    });

    if (method === "HEAD" && response.body != null) {
      await response.body.cancel();
    }
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
    return lifetime.ownResponse(withResponseHeaders(finalResponse, pipeline.corsHeadersInit));
  }));
}

function getLoggedResponseStatus(response: unknown, fallbackStatus: number | string | undefined) {
  return response instanceof Response ? response.status : fallbackStatus;
}

function createMethodNotAllowedResponse(methods: RouteMethods) {
  const allowedMethods = httpMethodNames.filter((method) => methods.has(method)
    || (method === "HEAD" && methods.has("GET")));
  return new Response(null, {
    status: 405,
    headers: {
      Allow: allowedMethods.join(", "),
    },
  });
}

import.meta.vitest?.test("development logging uses the returned Response status", ({ expect }) => {
  expect(getLoggedResponseStatus(new Response(null, { status: 404 }), 200)).toBe(404);
  expect(getLoggedResponseStatus("response body", 201)).toBe(201);
});

import.meta.vitest?.test("the Elysia response mapper compresses direct Node responses", async ({ expect }) => {
  const { gunzipSync } = await import("node:zlib");
  const response = await app.handle(new Request("http://localhost/", {
    headers: { "accept-encoding": "gzip" },
  }));

  expect(response.headers.get("content-encoding")).toBe("gzip");
  expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).toContain("Welcome to Hexclave's API endpoint");
});

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

function withResponseHeaders(response: Response, corsHeadersInit?: HeadersInit) {
  if (corsHeadersInit != null) {
    for (const [key, value] of new Headers(corsHeadersInit)) {
      response.headers.set(key, value);
    }
  }
  return withGlobalHeaders(response);
}

function htmlResponse(body: string, status = 200) {
  return withGlobalHeaders(new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  }));
}

function isObservabilityDebugRouteAvailable() {
  return getNodeEnvironment() !== "production"
    || getEnvVariable("VERCEL_ENV", "") === "preview";
}

import.meta.vitest?.test("dispatcher-generated API errors retain CORS headers", async ({ expect }) => {
  const { vi } = import.meta.vitest!;
  vi.stubEnv("HEXCLAVE_ARTIFICIAL_DEVELOPMENT_DELAY_MS", "0");
  vi.stubEnv("STACK_ARTIFICIAL_DEVELOPMENT_DELAY_MS", "0");

  try {
    const [notFound, methodNotAllowed, unknownMethod] = await Promise.all([
      app.handle(new Request("http://localhost/api/latest/this-route-does-not-exist")),
      app.handle(new Request("http://localhost/api/v2beta1/migration-tests/smart-route-handler", {
        method: "POST",
      })),
      app.handle(new Request("http://localhost/api/v2beta1/migration-tests/smart-route-handler", {
        method: "BREW",
      })),
    ]);

    expect([
      { status: notFound.status, allowOrigin: notFound.headers.get("access-control-allow-origin") },
      { status: methodNotAllowed.status, allow: methodNotAllowed.headers.get("allow"), allowOrigin: methodNotAllowed.headers.get("access-control-allow-origin") },
      { status: unknownMethod.status, allow: unknownMethod.headers.get("allow"), allowOrigin: unknownMethod.headers.get("access-control-allow-origin") },
    ]).toMatchInlineSnapshot(`
      [
        {
          "allowOrigin": "*",
          "status": 404,
        },
        {
          "allow": "GET, HEAD",
          "allowOrigin": "*",
          "status": 405,
        },
        {
          "allow": "GET, HEAD",
          "allowOrigin": "*",
          "status": 405,
        },
      ]
    `);
  } finally {
    vi.unstubAllEnvs();
  }
});

import.meta.vitest?.test("uncaught dispatch errors use the global sanitized error boundary", async ({ expect }) => {
  const { vi } = import.meta.vitest!;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("HEXCLAVE_ARTIFICIAL_DEVELOPMENT_DELAY_MS", "1");
  vi.stubEnv("STACK_ARTIFICIAL_DEVELOPMENT_DELAY_MS", "1");

  try {
    const response = await app.handle(new Request("http://localhost/api/v1"));

    expect({
      status: response.status,
      body: await response.text(),
      accessControlAllowOrigin: response.headers.get("access-control-allow-origin"),
      contentType: response.headers.get("content-type"),
      contentTypeOptions: response.headers.get("x-content-type-options"),
    }).toMatchInlineSnapshot(`
      {
        "accessControlAllowOrigin": "*",
        "body": "Internal Server Error",
        "contentType": "text/plain; charset=utf-8",
        "contentTypeOptions": "nosniff",
        "status": 500,
      }
    `);
  } finally {
    vi.unstubAllEnvs();
  }
});

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

function isHttpMethod(method: string): method is typeof httpMethodNames[number] {
  return knownHttpMethods.has(method);
}
