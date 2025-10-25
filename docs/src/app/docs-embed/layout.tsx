import { EmbeddedDocsMessageBridge } from '@/components/embedded-docs-message-bridge';
import { DocsHeaderWrapper } from '@/components/layouts/docs-header-wrapper';
import { DynamicDocsLayout } from '@/components/layouts/docs-layout-router';
import { DocsLayoutWrapper } from '@/components/layouts/docs-layout-wrapper';
import { SidebarProvider } from '@/components/layouts/sidebar-context';
import { source } from 'lib/source';
import type { ReactNode } from 'react';

// Embedded layout for main docs - includes full header and sidebar for iframe
export default function DocsEmbedLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <DocsLayoutWrapper>
        <EmbeddedDocsMessageBridge />
        {/* Docs Header Wrapper - provides navigation and platform selector */}
        <DocsHeaderWrapper
          showSearch={false}
          pageTree={source.pageTree}
        />

        {/* Docs Layout Content - with full sidebar */}
        <div>
          <DynamicDocsLayout
            tree={source.pageTree}
          >
            {children}
          </DynamicDocsLayout>
        </div>
      </DocsLayoutWrapper>
    </SidebarProvider>
  );
}
