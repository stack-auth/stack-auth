import { EnhancedAPIPage } from '@/components/api/enhanced-api-page';
import { getMDXComponents } from '@/mdx-components';
import { apiSource } from 'lib/source';
import { redirect } from 'next/navigation';

export default async function ApiPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>,
}) {
  const { slug } = await params;
  const page = apiSource.getPage(slug ?? []);

  if (!page) redirect("/");

  const MDX = page.data.body;

  return <MDX components={getMDXComponents({ EnhancedAPIPage })} />;
}
