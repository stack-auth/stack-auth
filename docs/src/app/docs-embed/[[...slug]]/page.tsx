import { EmbeddedDocsWithSidebar } from '@/components/embedded-docs-with-sidebar';
import { getEmbeddedMDXComponents } from '@/mdx-components';
import { source } from 'lib/source';
import { redirect } from 'next/navigation';

export default async function DocsEmbedPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>,
}) {
  const { slug } = await params;

  // If no slug provided, redirect to overview
  if (!slug || slug.length === 0) {
    redirect('/docs-embed/next/overview');
  }

  const page = source.getPage(slug);

  if (!page) {
    // Try to redirect to a sensible default if page not found
    redirect('/docs-embed/next/overview');
  }

  const MDX = page.data.body;

  return (
    <EmbeddedDocsWithSidebar
      pageTree={source.pageTree}
      currentSlug={slug}
    >
      <div className="p-6 prose prose-neutral dark:prose-invert max-w-none overflow-x-hidden">
        <div className="w-full">
          <MDX components={getEmbeddedMDXComponents()} />
        </div>
      </div>
    </EmbeddedDocsWithSidebar>
  );
}
