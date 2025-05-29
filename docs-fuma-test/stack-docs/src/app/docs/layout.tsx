import { baseOptions } from '@/app/layout.config';
import { DocsLayout } from '@/components/layouts/docs';
import { source } from '@/lib/source';
import type { ReactNode } from 'react';
import './custom-docs-styles.css';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout tree={source.pageTree} {...baseOptions}>
      {children}
    </DocsLayout>
  );
}
