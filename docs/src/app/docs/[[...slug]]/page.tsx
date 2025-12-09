import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from '@/components/layouts/page';
import { LLMCopyButton, ViewOptions } from '@/components/page-actions';
import { getMDXComponents } from '@/mdx-components';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { source } from 'lib/source';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';

function getDefaultDocsRedirectUrl(): string | null {
  const pages = source.getPages();
  // Prefer an overview page if one exists without platform prefix
  const overviewPage = pages.find(page => page.url === '/docs/overview');
  if (overviewPage) {
    return overviewPage.url;
  }

  // Fall back to the first docs page in the collection
  const firstDocsPage = pages.find(page => page.url.startsWith('/docs/'));
  return firstDocsPage?.url ?? null;
}

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>,
}) {
  const params = await props.params;

  // Handle redirect when no slug is provided (i.e., accessing /docs directly)
  if (!params.slug || params.slug.length === 0) {
    const fallbackUrl = getDefaultDocsRedirectUrl();
    if (fallbackUrl) {
      redirect(fallbackUrl);
    }

    redirect("/");
  }

  const page = source.getPage(params.slug);
  if (!page) redirect("/");

  const MDXContent = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <div className="flex flex-row items-center justify-between gap-4 mb-4">
        <DocsTitle>{page.data.title}</DocsTitle>
        <div className="flex flex-row gap-2 items-center">
          <LLMCopyButton markdownUrl={`${page.url}.mdx`} />
          <ViewOptions
            markdownUrl={`${page.url}.mdx`}
          />
        </div>
      </div>
      {/* Only show description if it exists and is not empty */}
      {page.data.description && page.data.description.trim() && (
        <DocsDescription>{page.data.description}</DocsDescription>
      )}
      <DocsBody>
        <MDXContent
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
      {/* Show last modified date at the bottom, tucked away */}
      {page.data.lastModified && (
        <p className="text-xs text-fd-muted-foreground/50 mt-6">
          Last updated {page.data.lastModified}
        </p>
      )}
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>,
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) redirect("/");

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
