import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from '@/components/layouts/page';
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
    redirect('/docs-embed/overview');
  }

  const page = source.getPage(slug);

  if (!page) {
    // Redirect to overview if page not found
    redirect('/docs-embed/overview');
  }

  const MDXContent = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      {page.data.description && page.data.description.trim() && (
        <DocsDescription>{page.data.description}</DocsDescription>
      )}
      <DocsBody>
        <MDXContent components={getEmbeddedMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}
