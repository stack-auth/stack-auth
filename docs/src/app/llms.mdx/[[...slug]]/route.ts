import { notFound } from 'next/navigation';
import { type NextRequest, NextResponse } from 'next/server';
import { getLLMText } from '../../../../lib/get-llm-text';
import { apiSource, source } from '../../../../lib/source';

export const revalidate = false;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;

  // Try to find the page in either source
  let page = source.getPage(slug);

  // If not found in main docs, try API docs
  if (!page) {
    page = apiSource.getPage(slug);
  }

  if (!page) notFound();

  try {
    return new NextResponse(await getLLMText(page));
  } catch (error) {
    console.error('Error generating LLM text:', error);
    return new NextResponse('Error generating content', { status: 500 });
  }
}

export function generateStaticParams() {
  try {
    // Generate static params for both main docs and API docs
    const docsParams = source.generateParams();
    const apiParams = apiSource.generateParams();

    return [...docsParams, ...apiParams];
  } catch (error) {
    console.error('Error generating static params:', error);
    // Return empty array to prevent build failure
    return [];
  }
}
