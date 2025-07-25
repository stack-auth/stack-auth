import { source } from 'lib/source';
import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

export function GET(request: NextRequest) {
  const pathname = new URL(request.url).pathname;

  // Ensure we have the correct target path without double prefixes
  const targetPath = pathname.startsWith('/docs') ? pathname : '/docs' + pathname;

  // Extract slug by removing any '/docs' prefix and splitting by '/'
  const cleanPath = pathname.startsWith('/docs') ? pathname.substring(5) : pathname;
  const slug = cleanPath.substring(1).split('/').filter(Boolean);

  // Check if the target page exists
  const page = source.getPage(slug);

  if (page) {
    // Page exists, redirect to the full path
    return redirect(targetPath);
  } else {
    // Page doesn't exist, redirect to overview
    return redirect('/docs/react/overview');
  }
}
