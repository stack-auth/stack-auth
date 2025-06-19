import { EnhancedAPIPage } from '@/components/api/enhanced-api-page';
import { getMDXComponents } from '@/mdx-components';
import { apiSource } from 'lib/source';
import { notFound } from 'next/navigation';
import { APIPageWrapper } from '../../../components/api/api-page-wrapper';
import { SharedContentLayout } from '../../../components/layouts/shared-content-layout';

export default async function ApiPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>,
}) {
  const { slug } = await params;
  const page = apiSource.getPage(slug ?? []);

  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <APIPageWrapper>
      <SharedContentLayout className="prose prose-neutral dark:prose-invert max-w-none">
        <MDX components={getMDXComponents({ EnhancedAPIPage })} />
      </SharedContentLayout>
    </APIPageWrapper>
  );
}
