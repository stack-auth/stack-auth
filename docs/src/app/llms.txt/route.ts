import { stringCompare } from '@stackframe/stack-shared/dist/utils/strings';
import { apiSource, source } from 'lib/source';

// cached forever
export const revalidate = false;

export async function GET(request: Request) {
  const docsUrls = new Set<string>();
  const apiUrls = new Set<string>();
  const docsBaseUrl = new URL('/llms/docs/', request.url).toString();
  const apiBaseUrl = new URL('/llms/api/', request.url).toString();

  for (const page of source.getPages()) {
    const relativeUrl = page.url.replace(/^\/docs\/?/, '');
    if (relativeUrl !== '') {
      docsUrls.add(relativeUrl);
    }
  }

  for (const page of apiSource.getPages()) {
    const relativeUrl = page.url.replace(/^\/api\/?/, '');
    if (relativeUrl !== '') {
      apiUrls.add(relativeUrl);
    }
  }

  const body = [
    '# Stack Auth Docs',
    `docs base url: ${docsBaseUrl}`,
    '',
    ...[...docsUrls].sort((left, right) => stringCompare(left, right)),
    '',
    `api base url: ${apiBaseUrl}`,
    '',
    ...[...apiUrls].sort((left, right) => stringCompare(left, right)),
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
