import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  // Add pathname to headers so we can access it in server components
  const response = NextResponse.next();
  const pathname = request.nextUrl.pathname;

  //console.log('🔧 Middleware: Setting pathname header:', pathname);
  response.headers.set('x-stack-pathname', pathname);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - .well-known (well-known files)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.well-known).*)',
  ],
};
