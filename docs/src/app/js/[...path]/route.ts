import { source } from 'lib/source';
import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

export function GET(request: NextRequest) {
  const pathname = new URL(request.url).pathname;
  const targetPath = '/docs' + pathname;

  // Extract slug by removing '/docs' prefix and splitting by '/'
  const slug = pathname.substring(1).split('/').filter(Boolean);

  // Check if the target page exists
  const page = source.getPage(slug);

  if (page) {
    // Page exists, redirect to the full path
    return redirect(targetPath);
  } else {
    // Page doesn't exist, redirect to overview
    return redirect('/docs/js/overview');
  }
}
