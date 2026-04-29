import "./polyfills";

import { NotFoundHandler } from "@/route-handlers/not-found-handler";
import { SmartRouter } from "@/smart-router";
import { opentelemetry } from "@elysia/opentelemetry";
import { Elysia } from "elysia";
import routes from "./generated/routes.json";
import { runWithRequestContext, toStackNextRequest, type StackNextRequest } from "./next-compat";
import { proxy } from "./proxy";

const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;
type HttpMethod = typeof httpMethods[number];

type RouteInfo = {
  filePath: string,
  normalizedPath: string,
  isRoute: boolean,
};

type RouteHandler = (
  request: StackNextRequest,
  options: { params: Promise<Record<string, string | string[]>> },
) => Promise<Response> | Response;

type RouteModule = Partial<Record<HttpMethod, RouteHandler>>;

function routeSpecificityScore(route: RouteInfo): number {
  return route.normalizedPath.split("/").reduce((score, segment) => {
    if (!segment) {
      return score;
    }
    if (segment.startsWith("[[...")) {
      return score - 100;
    }
    if (segment.startsWith("[...")) {
      return score - 50;
    }
    if (segment.startsWith("[")) {
      return score + 5;
    }
    return score + 20;
  }, 0);
}

const routeInfos = (routes as RouteInfo[])
  .filter((route) => route.isRoute)
  .sort((a, b) => {
    const scoreDiff = routeSpecificityScore(b) - routeSpecificityScore(a);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return b.normalizedPath.length - a.normalizedPath.length;
  });

const routeModuleCache = new Map<string, Promise<RouteModule>>();

async function loadRouteModule(route: RouteInfo): Promise<RouteModule> {
  let cached = routeModuleCache.get(route.filePath);
  if (!cached) {
    cached = import(new URL(`../${route.filePath}`, import.meta.url).toString())
      // Dynamic route modules are framework entrypoints whose shape is validated here by method lookup.
      .then((module) => module as RouteModule);
    routeModuleCache.set(route.filePath, cached);
  }
  return await cached;
}

function appendHeaders(target: Headers, source: Headers) {
  for (const [key, value] of source.entries()) {
    target.append(key, value);
  }
}

async function dispatchToRoute(request: StackNextRequest, routePathname: string): Promise<Response> {
  for (const route of routeInfos) {
    const params = SmartRouter.matchNormalizedPath(routePathname, route.normalizedPath);
    if (!params) {
      continue;
    }

    const routeModule = await loadRouteModule(route);
    const method = request.method as HttpMethod;
    const handler = routeModule[method] ?? (method === "HEAD" ? routeModule.GET : undefined);
    if (!handler) {
      return new Response("Method not allowed", {
        status: 405,
      });
    }

    return await handler(request, {
      params: Promise.resolve(params),
    });
  }

  return await NotFoundHandler(request, {
    params: Promise.resolve({}),
  });
}

export const app = new Elysia()
  .use(opentelemetry())
  .all("*", async ({ request }) => {
    const originalRequest = toStackNextRequest(request);
    const proxyResult = await proxy(originalRequest);
    if (proxyResult.type === "response") {
      return proxyResult.response;
    }

    const { result: response, responseHeaders: requestContextHeaders } = await runWithRequestContext(
      proxyResult.request,
      async () => await dispatchToRoute(proxyResult.request, proxyResult.routePathname),
    );

    const finalHeaders = new Headers(response.headers);
    appendHeaders(finalHeaders, proxyResult.responseHeaders);
    appendHeaders(finalHeaders, requestContextHeaders);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: finalHeaders,
    });
  });
