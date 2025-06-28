import { getLLMText } from 'lib/get-llm-text';
import { apiSource, source } from 'lib/source';
import { notFound } from 'next/navigation';
import { type NextRequest, NextResponse } from 'next/server';

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

  return new NextResponse(await getLLMText(page));
}

export function generateStaticParams() {
  // Generate static params for both main docs and API docs
  const docsParams = source.generateParams();
  const apiParams = apiSource.generateParams();

  return [...docsParams, ...apiParams];
}
