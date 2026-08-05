import { httpMethodNames, routeModules } from "@/generated/route-modules";
import { SmartRouter } from "@/smart-router";
import { DEFAULT_ROUTE_MAX_DURATION_SECONDS, validateRouteMaxDurationSeconds } from "./runtime-limits";

type HttpMethod = typeof httpMethodNames[number];
type RouteParams = Record<string, string | string[]>;
type RouteHandlerOptions = { params: Promise<RouteParams> };
type RouteHandler = (request: Request, options: RouteHandlerOptions) => Promise<Response> | Response;
export type UnknownRouteModule = Partial<Record<HttpMethod, unknown>> & { maxDuration?: unknown };
type UnknownRouteFunction = (request: Request, options: RouteHandlerOptions) => unknown;
export type RouteMethods = Map<HttpMethod, RouteHandler>;

type RouteEntry = {
  loadMethods: () => Promise<RouteMethods>,
  maxDurationSeconds: number,
  normalizedPath: string,
  specificity: number[],
};

type RouteMatch = {
  loadMethods: () => Promise<RouteMethods>,
  maxDurationSeconds: number,
  normalizedPath: string,
  params: Record<string, string | string[]>,
};

const routeRegistry = buildRouteRegistry();

export function matchRoute(dispatchPath: string): RouteMatch | undefined {
  for (const entry of routeRegistry) {
    const params = SmartRouter.matchNormalizedPath(dispatchPath, entry.normalizedPath);
    if (params !== false) {
      return {
        loadMethods: entry.loadMethods,
        maxDurationSeconds: entry.maxDurationSeconds,
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
      const maxDurationSeconds = validateRouteMaxDurationSeconds(
        route.maxDurationSeconds ?? DEFAULT_ROUTE_MAX_DURATION_SECONDS,
        route.normalizedPath,
      );
      return {
        loadMethods: createRouteMethodsLoader(route.normalizedPath, maxDurationSeconds, route.load),
        maxDurationSeconds,
        normalizedPath: route.normalizedPath,
        specificity: getSpecificity(route.normalizedPath),
      };
    })
    .sort(compareRouteEntries);
}

function createRouteMethodsLoader(
  normalizedPath: string,
  maxDurationSeconds: number,
  loadModule: () => Promise<UnknownRouteModule>,
) {
  let methodsPromise: Promise<RouteMethods> | undefined;
  return () => {
    // Cache the promise, not only the resolved module, so concurrent first requests
    // share one import and a deterministic initialization failure stays route-local.
    methodsPromise ??= loadModule().then((routeModule) => {
      const exportedMaxDuration = routeModule.maxDuration;
      if (exportedMaxDuration !== undefined && exportedMaxDuration !== maxDurationSeconds) {
        throw new Error(
          `Generated maxDuration metadata for ${normalizedPath} is stale: expected ${maxDurationSeconds}, received ${String(exportedMaxDuration)}.`,
        );
      }
      const methods: RouteMethods = new Map();
      for (const method of httpMethodNames) {
        const handler = routeModule[method];
        if (isRouteFunction(handler)) {
          methods.set(method, createRouteHandler(normalizedPath, method, handler));
        }
      }
      return methods;
    });
    return methodsPromise;
  };
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

import.meta.vitest?.test("route modules are loaded lazily and only once", async ({ expect }) => {
  let loadCount = 0;
  const loadMethods = createRouteMethodsLoader("/api/latest/test", DEFAULT_ROUTE_MAX_DURATION_SECONDS, async () => {
    loadCount++;
    return {
      GET: async () => new Response("ok"),
    };
  });

  expect(loadCount).toBe(0);
  const [firstMethods, secondMethods] = await Promise.all([loadMethods(), loadMethods()]);
  expect(loadCount).toBe(1);
  expect(firstMethods).toBe(secondMethods);
  const handler = firstMethods.get("GET");
  if (handler == null) {
    throw new Error("The test route should expose a GET handler");
  }
  const response = await handler(new Request("http://localhost/api/latest/test"), {
    params: Promise.resolve({}),
  });
  expect(await response.text()).toMatchInlineSnapshot(`"ok"`);
});

import.meta.vitest?.test("a failed route import stays isolated to its loader", async ({ expect }) => {
  const failingLoader = createRouteMethodsLoader("/failing", DEFAULT_ROUTE_MAX_DURATION_SECONDS, async () => {
    throw new Error("route import failed");
  });
  const healthyLoader = createRouteMethodsLoader("/healthy", DEFAULT_ROUTE_MAX_DURATION_SECONDS, async () => ({
    GET: async () => new Response("healthy"),
  }));

  await expect(failingLoader()).rejects.toThrowErrorMatchingInlineSnapshot(`
    [Error: route import failed]
  `);
  expect((await healthyLoader()).has("GET")).toBe(true);
});
