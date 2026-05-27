import { getEnvVariable, getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import './polyfills';

import { HexclaveAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
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

// Hexclave rebrand: every `x-stack-*` header is dual-accepted under its `x-hexclave-*` equivalent.
// Derive the alias names so the CORS allowlists never drift. See RENAME-TO-HEXCLAVE.md (Tier 0).
function withHexclaveHeaderAliases(headers: string[]): string[] {
  return headers.flatMap((header) => header.startsWith('x-stack-')
    ? [header, `x-hexclave-${header.slice('x-stack-'.length)}`]
    : [header]);
}
const corsAllowedRequestHeadersWithAliases = withHexclaveHeaderAliases(corsAllowedRequestHeaders);
const corsAllowedResponseHeadersWithAliases = withHexclaveHeaderAliases(corsAllowedResponseHeaders);

export async function proxy(request: NextRequest) {
  const delay = Number.parseInt(getEnvVariable('STACK_ARTIFICIAL_DEVELOPMENT_DELAY_MS', '0'));
  if (delay) {
    if (getNodeEnvironment().includes('production')) {
      throw new HexclaveAssertionError('STACK_ARTIFICIAL_DEVELOPMENT_DELAY_MS is only allowed in development');
    }
    if (!request.headers.get('x-stack-disable-artificial-development-delay')) {
      await wait(delay);
    }
  }

  const url = new URL(request.url);
  const isApiRequest = url.pathname.startsWith('/api/');

  // Hexclave rebrand: dual-accept request headers — copy each `x-hexclave-*` onto its `x-stack-*`
  // equivalent so downstream API routes that read `x-stack-*` keep working unchanged. The new form
  // wins when both are present. See RENAME-TO-HEXCLAVE.md (Tier 0, HTTP request headers).
  const newRequestHeaders = new Headers(request.headers);
  for (const [name, value] of request.headers) {
    if (name.startsWith('x-hexclave-')) {
      newRequestHeaders.set(`x-stack-${name.slice('x-hexclave-'.length)}`, value);
    }
  }

  // default headers
  const responseInit = {
    request: {
      headers: newRequestHeaders,
    },
    headers: {
      // CORS headers
      ...(!isApiRequest ? {} : {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": corsAllowedRequestHeadersWithAliases.join(', '),
        "Access-Control-Expose-Headers": corsAllowedResponseHeadersWithAliases.join(', '),
      }),
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
