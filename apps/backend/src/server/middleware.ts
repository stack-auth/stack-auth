import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { wait } from "@hexclave/shared/dist/utils/promises";
import apiVersions from "@/generated/api-versions.json";
import routes from "@/generated/routes.json";
import { SmartRouter } from "@/smart-router";

const DEV_RATE_LIMIT_MAX_REQUESTS = 100;
const DEV_RATE_LIMIT_WINDOW_MS = 10_000;
const devRateLimitTimestamps: number[] = [];

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
  middlewareRewrite?: string,
  originalUrl: string,
  shortCircuitResponse?: Response,
};

export async function runRequestPipeline(request: Request): Promise<PipelineResult> {
  const url = new URL(request.url);
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
    const now = Date.now();
    while (devRateLimitTimestamps.length > 0 && now - devRateLimitTimestamps[0] > DEV_RATE_LIMIT_WINDOW_MS) {
      devRateLimitTimestamps.shift();
    }
    if (devRateLimitTimestamps.length >= DEV_RATE_LIMIT_MAX_REQUESTS) {
      const waitMs = Math.max(0, DEV_RATE_LIMIT_WINDOW_MS - (now - devRateLimitTimestamps[0]));
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
        mergedHeaders: mergeHexclaveHeaderAliases(request.headers),
        originalUrl: request.url,
        shortCircuitResponse: response,
      };
    }
    devRateLimitTimestamps.push(now);
  }

  const mergedHeaders = mergeHexclaveHeaderAliases(request.headers);

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
    middlewareRewrite: dispatchPath === url.pathname ? undefined : dispatchPath,
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
