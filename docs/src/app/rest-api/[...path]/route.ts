import { apiSource } from 'lib/source';
import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

export function GET(request: NextRequest) {
  const pathname = new URL(request.url).pathname;

  // For rest-api, we redirect to /api not /docs
  const targetPath = pathname.startsWith('/api') ? pathname : '/api' + pathname;

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
    return redirect('/api/overview');
  }
}
