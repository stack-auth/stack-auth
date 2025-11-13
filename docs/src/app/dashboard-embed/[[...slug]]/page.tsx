import { getEmbeddedMDXComponents } from '@/mdx-components';
import { dashboardSource } from 'lib/source';
import { redirect } from 'next/navigation';

export default async function DashboardEmbedPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>,
}) {
  const { slug } = await params;
  const page = dashboardSource.getPage(slug ?? []);

  if (!page) redirect("/");

  const MDX = page.data.body;

  return (
    <div className="p-6 prose prose-neutral dark:prose-invert max-w-none overflow-x-hidden">
      <div className="w-full">
        <MDX components={getEmbeddedMDXComponents()} />
      </div>
    </div>
  );
}
