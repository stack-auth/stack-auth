import { stringCompare } from '@stackframe/stack-shared/dist/utils/strings';
import { apiSource, source } from 'lib/source';

// cached forever
export const revalidate = false;

export async function GET(request: Request) {
  const docsUrls = new Set<string>();
  const apiUrls = new Set<string>();
  const origin = new URL(request.url).origin;
  const docsBaseUrl = `${origin}/llms/docs/`;
  const apiBaseUrl = `${origin}/llms/api/`;

  for (const page of source.getPages()) {
    if (page.url !== '/docs' && !page.url.startsWith('/docs/')) {
      throw new Error(`Unexpected page URL "${page.url}" in docs source — expected "/docs" or "/docs/..." prefix`);
    }
    const relativeUrl = page.url === '/docs' ? '' : page.url.slice('/docs/'.length);
    if (relativeUrl !== '') {
      docsUrls.add(relativeUrl);
    }
  }

  for (const page of apiSource.getPages()) {
    if (page.url !== '/api' && !page.url.startsWith('/api/')) {
      throw new Error(`Unexpected page URL "${page.url}" in API source — expected "/api" or "/api/..." prefix`);
    }
    const relativeUrl = page.url === '/api' ? '' : page.url.slice('/api/'.length);
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
