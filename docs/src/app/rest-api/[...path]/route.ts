import { apiSource } from 'lib/source';
import { notFound, redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

export function GET(request: NextRequest) {
  const pathname = new URL(request.url).pathname;

  // For rest-api, we redirect to /api not /docs using proper URL construction
  let targetPath: string;
  if (pathname.startsWith('/api')) {
    targetPath = pathname;
  } else {
    // Remove leading slash and use as relative path to properly construct /api prefix
    targetPath = new URL(pathname.substring(1), 'file:///api/').pathname;
  }

  // Extract slug by removing any '/api' prefix and splitting by '/'
  const cleanPath = pathname.startsWith('/api') ? pathname.substring(4) : pathname;
  const slug = cleanPath.substring(1).split('/').filter(Boolean);

  // Check if the target page exists using apiSource for API docs
  const page = apiSource.getPage(slug);

  if (page) {
    // Page exists, redirect to the full path
    return redirect(targetPath);
  } else {
    // Page doesn't exist, redirect to overview
    return notFound();
  }
}
