import { trackVisit } from '2027-track';
import { NextFetchEvent, NextRequest, NextResponse } from 'next/server';

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  // Track AI agent visits
  event.waitUntil(
    trackVisit({
      host: request.headers.get('host') || request.nextUrl.host,
      path: pathname,
      userAgent: request.headers.get('user-agent') || '',
      accept: request.headers.get('accept') || '',
      country: request.headers.get('x-vercel-ip-country') || undefined,
    }).catch(() => {})
  );

  // Redirect old concepts paths to new apps paths
  const movedToApps = [
    'api-keys',
    'emails',
    'oauth',
    'orgs-and-teams',
    'permissions',
    'webhooks',
  ];

  if (pathname.startsWith('/docs/concepts/')) {
    const pageName = pathname.replace('/docs/concepts/', '');
    if (movedToApps.includes(pageName)) {
      const url = request.nextUrl.clone();
      url.pathname = `/docs/apps/${pageName}`;
      return NextResponse.redirect(url, 301); // 301 = permanent redirect
    }
  }

  // Only apply to docs and api pages (not already .mdx requests)
  // Match /docs, /docs/, /docs/... and /api, /api/, /api/...
  const isDocsPath = pathname === '/docs' || pathname.startsWith('/docs/');
  const isApiPath = pathname === '/api' || pathname.startsWith('/api/');

  if ((isDocsPath || isApiPath) && !pathname.endsWith('.mdx')) {
    const acceptHeader = request.headers.get('accept') || '';

    // Parse Accept header by splitting on commas to properly handle MIME type ordering
    const acceptTypes = acceptHeader.split(',').map((t: string) => t.trim().split(';')[0]);

    // Find the index of each MIME type in the Accept header
    const plainIndex = acceptTypes.findIndex(
      (t: string) => t === 'text/plain' || t === 'text/markdown'
    );
    const htmlIndex = acceptTypes.findIndex((t: string) => t === 'text/html');

    // Prefer markdown if text/plain or text/markdown appears before text/html (or text/html doesn't exist)
    const prefersMarkdown = plainIndex !== -1 && (htmlIndex === -1 || plainIndex < htmlIndex);

    if (prefersMarkdown) {
      // Rewrite to the LLM markdown endpoint
      const url = request.nextUrl.clone();
      url.pathname = `/llms.mdx${pathname.replace(/^\/(docs|api)/, '')}`;

      // Preserve query parameters (platform, framework, etc.)
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/docs/:path*',
    '/api/:path*',
  ],
};

