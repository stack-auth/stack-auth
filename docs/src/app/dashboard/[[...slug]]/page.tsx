import { getMDXComponents } from '@/mdx-components';
import { dashboardSource } from 'lib/source';
import { redirect } from 'next/navigation';
import { SharedContentLayout } from '../../../components/layouts/shared-content-layout';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>,
}) {
  const { slug } = await params;
  const page = dashboardSource.getPage(slug ?? []);

  if (!page) redirect("/");

  const MDX = page.data.body;

  return (
    <SharedContentLayout className="prose prose-neutral dark:prose-invert max-w-none">
      <MDX components={getMDXComponents()} />
    </SharedContentLayout>
  );
}
