import { DocsHeaderWrapper } from '@/components/layouts/docs-header-wrapper';
import { DynamicDocsLayout } from '@/components/layouts/docs-layout-router';
import { SidebarProvider } from '@/components/layouts/sidebar-context';
import { source } from 'lib/source';
import type { ReactNode } from 'react';
import './custom-docs-styles.css';

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="mx-auto">
        {/* Docs Header Wrapper - Provides sidebar content to mobile navigation */}
        <DocsHeaderWrapper
          showSearch={true}
          pageTree={source.pageTree}
        />

        {/* Docs Layout Content - with top margin for fixed header */}
        <div>
          <DynamicDocsLayout
            tree={source.pageTree}
          >
            {children}
          </DynamicDocsLayout>
        </div>
      </div>
    </SidebarProvider>
  );
}
