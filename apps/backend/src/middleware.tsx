import { getEnvVariable, getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { wait } from '@stackframe/stack-shared/dist/utils/promises';
import apiVersions from './generated/api-versions.json';
import routes from './generated/routes.json';
import './polyfills';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SmartRouter } from './smart-router';

const corsAllowedRequestHeaders = [
  // General
  'content-type',
  'authorization',  // used for OAuth basic authentication
  'x-stack-project-id',
  'x-stack-branch-id',
  'x-stack-override-error-status',
  'x-stack-random-nonce',  // used to forcefully disable some caches
  'x-stack-client-version',
  'x-stack-disable-artificial-development-delay',

  // Project auth
  'x-stack-access-type',
  'x-stack-publishable-client-key',
  'x-stack-secret-server-key',
  'x-stack-super-secret-admin-key',
  'x-stack-admin-access-token',

  // User auth
  'x-stack-refresh-token',
  'x-stack-access-token',

  // Sentry
  'baggage',
  'sentry-trace',

  // Vercel
  'x-vercel-protection-bypass',
];

const corsAllowedResponseHeaders = [
  'content-type',
  'x-stack-actual-status',
  'x-stack-known-error',
];

// This function can be marked `async` if using `await` inside
export async function middleware(request: NextRequest) {
  const delay = +getEnvVariable('STACK_ARTIFICIAL_DEVELOPMENT_DELAY_MS', '0');
  if (delay) {
    if (getNodeEnvironment().includes('production')) {
      throw new StackAssertionError('STACK_ARTIFICIAL_DEVELOPMENT_DELAY_MS environment variable is only allowed in development');
    }
    if (!request.headers.get('x-stack-disable-artificial-development-delay')) {
      await wait(delay);
    }
  }

  const url = new URL(request.url);
  const isApiRequest = url.pathname.startsWith('/api/');

  const newRequestHeaders = new Headers(request.headers);
  // here we could update the request headers (currently we don't)

  const responseInit = isApiRequest ? {
    request: {
      headers: newRequestHeaders,
    },
    headers: {
      // CORS headers
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Max-Age": "86400",  // 1 day (capped to lower values, eg. 10min, by some browsers)
      "Access-Control-Allow-Headers": corsAllowedRequestHeaders.join(', '),
      "Access-Control-Expose-Headers": corsAllowedResponseHeaders.join(', '),
    },
  } as const : undefined;

  // we want to allow preflight requests to pass through
  // even if the API route does not implement OPTIONS
  if (request.method === 'OPTIONS' && isApiRequest) {
    return new Response(null, responseInit);
  }

  // if no route is available for the requested version, rewrite to newer version
  let pathname = url.pathname;
  outer: for (let i = 0; i < apiVersions.length - 1; i++) {
    const version = apiVersions[i];
    const nextVersion = apiVersions[i + 1];
    if (!nextVersion.migrationFolder) {
      throw new StackAssertionError(`No migration folder found for version ${nextVersion.name}. This is a bug because every version except the first should have a migration folder.`);
    }
    if ((pathname + "/").startsWith(version.servedRoute + "/")) {
      const nextPathname = pathname.replace(version.servedRoute, nextVersion.servedRoute);
      const migrationPathname = nextPathname.replace(nextVersion.servedRoute, nextVersion.migrationFolder);
      // okay, we're in an API version of the current version. let's check if at least one route matches this URL (doesn't matter which)
      for (const route of routes) {
        if (nextVersion.migrationFolder && (route.normalizedPath + "/").startsWith(nextVersion.migrationFolder + "/")) {
          if (SmartRouter.matchNormalizedPath(migrationPathname, route.normalizedPath)) {
            // success! we found a route that matches the request
            // rewrite request to the migration folder
            pathname = migrationPathname;
            break outer;
          }
        }
      }
      // if no route matches, rewrite to the next version
      pathname = nextPathname;
    }
  }

  const newUrl = request.nextUrl.clone();
  newUrl.pathname = pathname;
  return NextResponse.rewrite(newUrl, responseInit);
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: '/:path*',
};
