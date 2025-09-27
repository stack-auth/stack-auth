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

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>,
}) {
  const params = await props.params;

  // Handle redirect when no slug is provided (i.e., accessing /docs directly)
  if (!params.slug || params.slug.length === 0) {
    redirect("/docs/next/overview");
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
