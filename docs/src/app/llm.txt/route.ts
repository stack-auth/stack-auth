import { NextResponse, type NextRequest } from 'next/server';

export const revalidate = false;

export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/llms.txt', request.url), 307);
}
