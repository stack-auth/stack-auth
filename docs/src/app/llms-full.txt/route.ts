import { getLLMText } from 'lib/get-llm-text';
import { apiSource, source } from 'lib/source';

// cached forever
export const revalidate = false;

export async function GET() {
  const docsPages = source.getPages();
  const apiPages = apiSource.getPages();

  const docsPromises = docsPages.map(getLLMText);
  const apiPromises = apiPages.map(getLLMText);

  const [docsContent, apiContent] = await Promise.all([
    Promise.all(docsPromises),
    Promise.all(apiPromises)
  ]);

  return new Response([...docsContent, ...apiContent].join('\n\n'));
}
