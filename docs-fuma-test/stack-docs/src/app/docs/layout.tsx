import { DynamicDocsLayout } from '@/components/layouts/dynamic-docs';
import { source } from '@/lib/source';
import type { ReactNode } from 'react';
import './custom-docs-styles.css';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DynamicDocsLayout tree={source.pageTree}>
      {children}
    </DynamicDocsLayout>
  );
}
