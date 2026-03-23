import { getLLMText } from '../../../lib/get-llm-text';
import { apiSource, source } from '../../../lib/source';

export const revalidate = false;

export async function GET() {
  const pages = [...source.getPages(), ...apiSource.getPages()];
  const texts = await Promise.all(pages.map(getLLMText));

  return new Response(texts.join('\n\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
