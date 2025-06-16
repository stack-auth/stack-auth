import { DocsHeaderWrapper } from '@/components/layouts/docs-header-wrapper';
import { DynamicDocsLayout } from '@/components/layouts/docs-layout-router';
import { source } from 'lib/source';
import './custom-docs-styles.css';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {/* Docs Header Wrapper - Provides sidebar content to mobile navigation */}
      <DocsHeaderWrapper showSearch={true} pageTree={source.pageTree} />

      {/* Docs Layout Content - with top margin for fixed header */}
      <div className="pt-14">
        <DynamicDocsLayout tree={source.pageTree}>
          {children}
        </DynamicDocsLayout>
      </div>
    </div>
  );
}
