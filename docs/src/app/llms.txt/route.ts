import { getLLMText } from 'lib/get-llm-text';
import { apiSource, source } from 'lib/source';

// cached forever
export const revalidate = false;

export async function GET() {
  // Get all pages from both main docs and API docs
  const docsPages = source.getPages();
  const apiPages = apiSource.getPages();

  // Process all pages
  const docsPromises = docsPages.map(getLLMText);
  const apiPromises = apiPages.map(getLLMText);

  const [docsContent, apiContent] = await Promise.all([
    Promise.all(docsPromises),
    Promise.all(apiPromises)
  ]);

  // Combine all content
  const allContent = [...docsContent, ...apiContent];

  return new Response(allContent.join('\n\n'));
}
