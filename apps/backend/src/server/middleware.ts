import apiVersions from "@/generated/api-versions.json";
import routes from "@/generated/routes.json";
import { SmartRouter } from "@/smart-router";
import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { wait } from "@hexclave/shared/dist/utils/promises";

const DEV_RATE_LIMIT_MAX_REQUESTS = 100;
const DEV_RATE_LIMIT_WINDOW_MS = 10_000;
const devRateLimitMarks: number[] = [];

const corsAllowedRequestHeaders = [
  "content-type",
  "authorization",
  "x-stack-project-id",
  "x-stack-branch-id",
  "x-stack-override-error-status",
  "x-stack-random-nonce",
  "x-stack-client-version",
  "x-stack-disable-artificial-development-delay",
  "x-stack-access-type",
  "x-stack-publishable-client-key",
  "x-stack-secret-server-key",
  "x-stack-super-secret-admin-key",
  "x-stack-admin-access-token",
  "x-stack-refresh-token",
  "x-stack-access-token",
  "x-stack-allow-restricted-user",
  "x-stack-allow-anonymous-user",
  "baggage",
  "sentry-trace",
  "x-vercel-protection-bypass",
  "ngrok-skip-browser-warning",
];

const corsAllowedResponseHeaders = [
  "content-type",
  "x-stack-actual-status",
  "x-stack-known-error",
];

function withHexclaveHeaderAliases(headers: string[]): string[] {
  return headers.flatMap((header) => header.startsWith("x-stack-")
    ? [header, `x-hexclave-${header.slice("x-stack-".length)}`]
    : [header]);
}

const corsAllowedRequestHeadersWithAliases = withHexclaveHeaderAliases(corsAllowedRequestHeaders);
const corsAllowedResponseHeadersWithAliases = withHexclaveHeaderAliases(corsAllowedResponseHeaders);

export type PipelineResult = {
  corsHeadersInit?: HeadersInit,
  dispatchPath: string,
  mergedHeaders: Headers,
  originalUrl: string,
  shortCircuitResponse?: Response,
};

export async function runRequestPipeline(request: Request): Promise<PipelineResult> {
  const url = new URL(request.url);
  const mergedHeaders = mergeHexclaveHeaderAliases(request.headers);
  ensureForwardedForHeader(mergedHeaders, request);
  const delay = +getEnvVariable("STACK_ARTIFICIAL_DEVELOPMENT_DELAY_MS", "0");
  if (delay) {
    if (getNodeEnvironment().includes("production")) {
      throw new Error("STACK_ARTIFICIAL_DEVELOPMENT_DELAY_MS environment variable is only allowed in development");
    }
    if (!request.headers.get("x-stack-disable-artificial-development-delay")) {
      await wait(delay);
    }
  }

  const isApiRequest = url.pathname.startsWith("/api/");
  const corsHeadersInit = isApiRequest ? {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Headers": corsAllowedRequestHeadersWithAliases.join(", "),
    "Access-Control-Expose-Headers": corsAllowedResponseHeadersWithAliases.join(", "),
    "Vary": corsAllowedRequestHeadersWithAliases.join(", "),
  } : undefined;

  if (isApiRequest && !request.headers.get("x-stack-disable-artificial-development-delay") && getNodeEnvironment() === "development" && request.method !== "OPTIONS" && !request.url.includes(".well-known") && !request.url.includes("/api/latest/internal/external-db-sync/")) {
    const now = performance.now();
    while (devRateLimitMarks.length > 0 && now - devRateLimitMarks[0] > DEV_RATE_LIMIT_WINDOW_MS) {
      devRateLimitMarks.shift();
    }
    if (devRateLimitMarks.length >= DEV_RATE_LIMIT_MAX_REQUESTS) {
      const waitMs = Math.max(0, DEV_RATE_LIMIT_WINDOW_MS - (now - devRateLimitMarks[0]));
      const retryAfterSeconds = Math.max(1, Math.ceil(waitMs / 1000));

      const response = Response.json({
        message: "Artificial development rate limit triggered. Wait before retrying.",
      }, {
        status: 429,
      });

      if (Math.random() < 0.5 && corsHeadersInit) {
        for (const [key, value] of Object.entries(corsHeadersInit)) {
          response.headers.set(key, value);
        }
      }

      if (Math.random() < 0.5) {
        response.headers.set("Retry-After", retryAfterSeconds.toString());
      }

      return {
        corsHeadersInit,
        dispatchPath: url.pathname,
        mergedHeaders,
        originalUrl: request.url,
        shortCircuitResponse: response,
      };
    }
    devRateLimitMarks.push(now);
  }

  if (request.method === "OPTIONS" && isApiRequest) {
    return {
      corsHeadersInit,
      dispatchPath: url.pathname,
      mergedHeaders,
      originalUrl: request.url,
      shortCircuitResponse: new Response(null, {
        headers: corsHeadersInit,
      }),
    };
  }

  const dispatchPath = getDispatchPath(url.pathname);
  return {
    corsHeadersInit,
    dispatchPath,
    mergedHeaders,
    originalUrl: request.url,
  };
}

function mergeHexclaveHeaderAliases(headers: Headers) {
  const newRequestHeaders = new Headers(headers);
  for (const [name, value] of headers) {
    if (name.startsWith("x-hexclave-")) {
      newRequestHeaders.set(`x-stack-${name.slice("x-hexclave-".length)}`, value);
    }
  }
  return newRequestHeaders;
}

const clientIpForwardingHeaders = ["x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for", "cf-connecting-ip"];

function ensureForwardedForHeader(headers: Headers, request: Request) {
  // Direct connections (local dev, proxy-less self-host) arrive without any forwarding
  // header, so getEndUserIp() finds no client IP and warns on every request. The Node
  // adapter still knows the socket's remote address, so synthesize x-forwarded-for from
  // it — mirroring what the old Next.js dev server did. Behind a real proxy (e.g. Vercel)
  // one of these headers is already set, so this stays a no-op there.
  if (clientIpForwardingHeaders.some((header) => headers.has(header))) {
    return;
  }
  const socketIp = readClientSocketIp(request);
  if (socketIp == null) {
    return;
  }
  headers.set("x-forwarded-for", normalizeClientIp(socketIp));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readClientSocketIp(request: Request): string | undefined {
  // The Node adapter (srvx) augments the web Request with the resolved client IP and
  // the underlying Node socket, neither of which exist on the standard Request type.
  // Read them defensively at runtime instead of casting; on other runtimes (e.g. the
  // Vercel serverless entry) these are simply absent and we fall through to undefined.
  const directIp: unknown = Reflect.get(request, "ip");
  if (typeof directIp === "string" && directIp !== "") {
    return directIp;
  }
  const runtime: unknown = Reflect.get(request, "runtime");
  const node: unknown = isRecord(runtime) ? runtime.node : undefined;
  const req: unknown = isRecord(node) ? node.req : undefined;
  const socket: unknown = isRecord(req) ? req.socket : undefined;
  const remoteAddress: unknown = isRecord(socket) ? socket.remoteAddress : undefined;
  return typeof remoteAddress === "string" && remoteAddress !== "" ? remoteAddress : undefined;
}

function normalizeClientIp(ip: string): string {
  // Node sockets report IPv4 clients as IPv4-mapped IPv6 (e.g. "::ffff:127.0.0.1").
  // Normalize to the plain IPv4 form so it matches what proxies put in x-forwarded-for.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : ip;
}

import.meta.vitest?.test("ensureForwardedForHeader synthesizes the client IP for direct connections", ({ expect }) => {
  // Uses the adapter-provided client IP when no forwarding header is present.
  const fromIp = new Headers();
  ensureForwardedForHeader(fromIp, Object.assign(new Request("http://localhost/api/v1"), { ip: "203.0.113.7" }));
  expect(fromIp.get("x-forwarded-for")).toBe("203.0.113.7");

  // Falls back to the raw Node socket and normalizes IPv4-mapped IPv6 to plain IPv4.
  const fromSocket = new Headers();
  ensureForwardedForHeader(fromSocket, Object.assign(new Request("http://localhost/api/v1"), {
    runtime: { node: { req: { socket: { remoteAddress: "::ffff:127.0.0.1" } } } },
  }));
  expect(fromSocket.get("x-forwarded-for")).toBe("127.0.0.1");

  // Never overwrites an existing forwarding header (e.g. behind a trusted proxy like Vercel).
  const existing = new Headers({ "x-forwarded-for": "198.51.100.1" });
  ensureForwardedForHeader(existing, Object.assign(new Request("http://localhost/api/v1"), { ip: "203.0.113.7" }));
  expect(existing.get("x-forwarded-for")).toBe("198.51.100.1");

  // No socket info available (e.g. an unusual runtime) → leaves headers untouched.
  const none = new Headers();
  ensureForwardedForHeader(none, new Request("http://localhost/api/v1"));
  expect(none.get("x-forwarded-for")).toBe(null);
});

function getDispatchPath(originalPathname: string) {
  let pathname = originalPathname;
  outer: for (let i = 0; i < apiVersions.length - 1; i++) {
    const version = apiVersions[i];
    const nextVersion = apiVersions[i + 1];
    if (!nextVersion.migrationFolder) {
      throw new Error(`No migration folder found for version ${nextVersion.name}. This is a bug because every version except the first should have a migration folder.`);
    }
    if ((pathname + "/").startsWith(version.servedRoute + "/")) {
      const nextPathname = pathname.replace(version.servedRoute, nextVersion.servedRoute);
      const migrationPathname = nextPathname.replace(nextVersion.servedRoute, nextVersion.migrationFolder);
      for (const route of routes) {
        if (nextVersion.migrationFolder && (route.normalizedPath + "/").startsWith(nextVersion.migrationFolder + "/")) {
          if (SmartRouter.matchNormalizedPath(migrationPathname, route.normalizedPath)) {
            pathname = migrationPathname;
            break outer;
          }
        }
      }
      pathname = nextPathname;
    }
  }
  return pathname;
}
