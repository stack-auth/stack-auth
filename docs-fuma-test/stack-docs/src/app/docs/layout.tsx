import { DynamicDocsLayout } from '@/components/layouts/dynamic-docs';
import { source } from 'lib/source';
import './custom-docs-styles.css';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DynamicDocsLayout tree={source.pageTree}>
      {children}
    </DynamicDocsLayout>
  );
}
