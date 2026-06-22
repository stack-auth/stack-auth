import { httpMethodNames, routeModules } from "@/generated/route-modules";
import { SmartRouter } from "@/smart-router";
import type { NextRequest } from "next/server";

export type HttpMethod = typeof httpMethodNames[number];
export type RouteParams = Record<string, string | string[]>;
export type RouteHandlerOptions = { params: Promise<RouteParams> };
export type RouteHandler = (request: NextRequest, options: RouteHandlerOptions) => Promise<Response> | Response;
export type UnknownRouteModule = Partial<Record<HttpMethod, unknown>>;
type UnknownRouteFunction = (request: NextRequest, options: RouteHandlerOptions) => unknown;

type RouteEntry = {
  methods: Map<HttpMethod, RouteHandler>,
  normalizedPath: string,
  specificity: number[],
};

export type RouteMatch = {
  handler?: RouteHandler,
  methods: Map<HttpMethod, RouteHandler>,
  normalizedPath: string,
  params: Record<string, string | string[]>,
};

export const routeRegistry = buildRouteRegistry();

export function matchRoute(dispatchPath: string): RouteMatch | undefined {
  for (const entry of routeRegistry) {
    const params = SmartRouter.matchNormalizedPath(dispatchPath, entry.normalizedPath);
    if (params !== false) {
      return {
        methods: entry.methods,
        normalizedPath: entry.normalizedPath,
        params: decodeRouteParams(params),
      };
    }
  }
  return undefined;
}

export class MalformedRouteParamError extends Error {
  constructor(param: string) {
    super(`Malformed percent-encoding in route parameter: ${param}`);
    this.name = "MalformedRouteParamError";
  }
}

function strictDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new MalformedRouteParamError(value);
  }
}

function decodeRouteParams(params: Record<string, string | string[]>): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map(strictDecodeURIComponent) : strictDecodeURIComponent(value),
    ]),
  );
}

function buildRouteRegistry() {
  return routeModules
    .map((route) => {
      const methods = new Map<HttpMethod, RouteHandler>();
      for (const method of httpMethodNames) {
        const handler = route.module[method];
        if (isRouteFunction(handler)) {
          methods.set(method, createRouteHandler(route.normalizedPath, method, handler));
        }
      }
      return {
        methods,
        normalizedPath: route.normalizedPath,
        specificity: getSpecificity(route.normalizedPath),
      };
    })
    .filter((route) => route.methods.size > 0)
    .sort(compareRouteEntries);
}

function isRouteFunction(value: unknown): value is UnknownRouteFunction {
  return typeof value === "function";
}

function createRouteHandler(normalizedPath: string, method: HttpMethod, handler: UnknownRouteFunction): RouteHandler {
  return async (request, options) => {
    const result = await handler(request, options);
    if (result instanceof Response) {
      return result;
    }
    throw new Error(`Route ${normalizedPath} ${method} did not return a Response`);
  };
}

function compareRouteEntries(a: RouteEntry, b: RouteEntry) {
  const maxLength = Math.max(a.specificity.length, b.specificity.length);
  for (let i = 0; i < maxLength; i++) {
    const diff = (b.specificity[i] ?? 0) - (a.specificity[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return stringCompare(a.normalizedPath, b.normalizedPath);
}

function getSpecificity(normalizedPath: string) {
  return normalizedPath.split("/").filter(Boolean).map((segment) => {
    if (segment.startsWith("[[...") && segment.endsWith("]]")) {
      return 0;
    }
    if (segment.startsWith("[...") && segment.endsWith("]")) {
      return 1;
    }
    if (segment.startsWith("[") && segment.endsWith("]")) {
      return 2;
    }
    return 3;
  });
}

function stringCompare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
