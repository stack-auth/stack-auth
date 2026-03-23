import { stringCompare } from '@stackframe/stack-shared/dist/utils/strings';
import { apiSource, source } from 'lib/source';

// cached forever
export const revalidate = false;

function collectRelativeUrls(
  pages: ReturnType<typeof source.getPages>,
  prefix: string,
  label: string,
): string[] {
  const urls: string[] = [];
  for (const page of pages) {
    if (page.url !== `/${prefix}` && !page.url.startsWith(`/${prefix}/`)) {
      throw new Error(`Unexpected page URL "${page.url}" in ${label} source — expected "/${prefix}" or "/${prefix}/..." prefix`);
    }
    const relativeUrl = page.url === `/${prefix}` ? '' : page.url.slice(`/${prefix}/`.length);
    if (relativeUrl !== '') {
      urls.push(relativeUrl);
    }
  }
  return urls;
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const docsBaseUrl = `${origin}/llms/docs/`;
  const apiBaseUrl = `${origin}/llms/api/`;
  const docsUrls = collectRelativeUrls(source.getPages(), 'docs', 'docs');
  const apiUrls = collectRelativeUrls(apiSource.getPages(), 'api', 'API');

  const body = [
    '# Stack Auth Docs',
    `docs base url: ${docsBaseUrl}`,
    '',
    ...docsUrls.sort((left, right) => stringCompare(left, right)),
    '',
    `api base url: ${apiBaseUrl}`,
    '',
    ...apiUrls.sort((left, right) => stringCompare(left, right)),
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
