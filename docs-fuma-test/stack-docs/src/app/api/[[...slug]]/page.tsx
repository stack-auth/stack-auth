import { APIPage } from 'fumadocs-openapi/ui';
import { apiSource } from 'lib/source';
import { notFound } from 'next/navigation';

export default async function ApiPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const page = apiSource.getPage(slug ?? []);

  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <article className="prose prose-neutral dark:prose-invert max-w-none">
      <MDX components={{ APIPage }} />
    </article>
  );
} 
