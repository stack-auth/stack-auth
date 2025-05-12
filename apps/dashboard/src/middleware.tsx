import { getEnvVariable, getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import './polyfills';

import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { wait } from '@stackframe/stack-shared/dist/utils/promises';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const corsAllowedRequestHeaders = [
  // General
  'authorization',
  'content-type',
  'x-stack-project-id',
  'x-stack-override-error-status',
  'x-stack-random-nonce',  // used to forcefully disable some caches
  'x-stack-client-version',
  'x-stack-disable-artificial-development-delay',

  // Project auth
  'x-stack-request-type',
  'x-stack-publishable-client-key',
  'x-stack-secret-server-key',
  'x-stack-super-secret-admin-key',
  'x-stack-admin-access-token',

  // User auth
  'x-stack-refresh-token',
  'x-stack-access-token',
];

const corsAllowedResponseHeaders = [
  'content-type',
  'x-stack-actual-status',
  'x-stack-known-error',
];

export async function middleware(request: NextRequest) {
  const delay = Number.parseInt(getEnvVariable('STACK_ARTIFICIAL_DEVELOPMENT_DELAY_MS', '0'));
  if (delay) {
    if (getNodeEnvironment().includes('production')) {
      throw new StackAssertionError('STACK_ARTIFICIAL_DEVELOPMENT_DELAY_MS is only allowed in development');
    }
    if (!request.headers.get('x-stack-disable-artificial-development-delay')) {
      await wait(delay);
    }
  }

  const url = new URL(request.url);
  const isApiRequest = url.pathname.startsWith('/api/');

  // default headers
  const responseInit: ResponseInit = {
    headers: {
      // CORS headers
      ...!isApiRequest ? {} : {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": corsAllowedRequestHeaders.join(', '),
        "Access-Control-Expose-Headers": corsAllowedResponseHeaders.join(', '),
      },
    },
  };

  // we want to allow preflight requests to pass through
  // even if the API route does not implement OPTIONS
  if (request.method === 'OPTIONS' && isApiRequest) {
    return new Response(null, responseInit);
  }

  return NextResponse.next(responseInit);
}

export const config = {
  matcher: '/:path*',
};
