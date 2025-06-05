import { DocsLayout } from '@/components/layouts/docs';
import { source } from 'lib/source';
import './custom-docs-styles.css';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout tree={source.pageTree}>
      {children}
    </DocsLayout>
  );
}
