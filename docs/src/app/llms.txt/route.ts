import { stringCompare } from '@stackframe/stack-shared/dist/utils/strings';
import { apiSource, source } from 'lib/source';

// cached forever
export const revalidate = false;

export async function GET() {
  const docsUrls = new Set<string>();
  const apiUrls = new Set<string>();

  for (const page of source.getPages()) {
    docsUrls.add(`/llms${page.url}`.slice('/llms/docs/'.length));
  }

  for (const page of apiSource.getPages()) {
    apiUrls.add(`/llms${page.url}`.slice('/llms/api/'.length));
  }

  const body = [
    '# Stack Auth Docs',
    'docs base url: https://docs.stack-auth.com/llms/docs/',
    '',
    ...[...docsUrls].sort((left, right) => stringCompare(left, right)),
    '',
    'api base url: https://docs.stack-auth.com/llms/api/',
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
