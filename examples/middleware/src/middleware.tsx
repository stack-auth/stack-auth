import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { stackServerApp } from './stack';

export async function middleware(request: NextRequest) {
  console.log('Running middleware on URL: ', request.url);

  // fetch the user object, and redirect if not logged in
  const user = await stackServerApp.getUser();
  if (!user) {
    console.log('User in middleware is not logged in. Redirecting to sign-in page');
    return NextResponse.redirect(stackServerApp.urls.signIn);
  }

  console.log('User in middleware is logged in. ID: ', user.id);

  return NextResponse.next();
}

export const config = {
  matcher: '/protected/:path*',
};
