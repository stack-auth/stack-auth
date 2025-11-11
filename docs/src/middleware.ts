import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only apply to docs and api pages (not already .mdx requests)
  // Match /docs, /docs/, /docs/... and /api, /api/, /api/...
  const isDocsPath = pathname === '/docs' || pathname.startsWith('/docs/');
  const isApiPath = pathname === '/api' || pathname.startsWith('/api/');

  if ((isDocsPath || isApiPath) && !pathname.endsWith('.mdx')) {
    const acceptHeader = request.headers.get('accept') || '';

    // Parse Accept header by splitting on commas to properly handle MIME type ordering
    const acceptTypes = acceptHeader.split(',').map(t => t.trim().split(';')[0]);

    // Find the index of each MIME type in the Accept header
    const plainIndex = acceptTypes.findIndex(
      (t) => t === 'text/plain' || t === 'text/markdown'
    );
    const htmlIndex = acceptTypes.findIndex((t) => t === 'text/html');

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

