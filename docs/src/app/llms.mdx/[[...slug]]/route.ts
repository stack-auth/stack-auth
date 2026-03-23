import { NextResponse, type NextRequest } from 'next/server';
import { getLLMText } from '../../../../lib/get-llm-text';
import { apiSource, source } from '../../../../lib/source';

export const revalidate = false;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;

  let page = source.getPage(slug);
  if (!page) {
    page = apiSource.getPage(slug);
  }

  if (!page) {
    return NextResponse.redirect(new URL('/llms.txt', request.url), 307);
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
  return [...source.generateParams(), ...apiSource.generateParams()];
}
