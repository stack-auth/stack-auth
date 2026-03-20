import { NextResponse, type NextRequest } from 'next/server';
import { getLLMText } from '../../../../lib/get-llm-text';
import { apiSource, source } from '../../../../lib/source';

export const revalidate = false;

function resolvePage(slug: string[] | undefined) {
  if (slug == null || slug.length === 0) {
    return null;
  }

  const [prefix, ...rest] = slug;

  if (prefix === 'docs') {
    return source.getPage(rest);
  }

  if (prefix === 'api') {
    return apiSource.getPage(rest);
  }

  return source.getPage(slug) ?? apiSource.getPage(slug);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;

  if (slug == null || slug.length === 0) {
    return NextResponse.redirect(new URL('/llms.txt', request.url), 307);
  }

  const page = resolvePage(slug);

  if (!page) {
    return NextResponse.redirect(new URL('/', request.url), 307);
  }

  try {
    return new NextResponse(await getLLMText(page), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('Error generating LLM text:', error);
    return new NextResponse('Error generating content', { status: 500 });
  }
}

export function generateStaticParams() {
  try {
    const docsParams = source.generateParams().map((param) => ({
      slug: ['docs', ...param.slug],
    }));
    const apiParams = apiSource.generateParams().map((param) => ({
      slug: ['api', ...param.slug],
    }));

    return [...docsParams, ...apiParams];
  } catch (error) {
    console.error('Error generating static params:', error);
    return [];
  }
}
