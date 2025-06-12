import { DynamicDocsLayout } from '@/components/layouts/docs-layout-router';
import { PlatformAwareHeader } from '@/components/layouts/platform-aware-header';
import { source } from 'lib/source';
import './custom-docs-styles.css';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {/* Platform-Aware Header Component */}
      <PlatformAwareHeader showSearch={true} />

      {/* Docs Layout Content - with top margin for fixed header */}
      <div className="pt-14">
        <DynamicDocsLayout tree={source.pageTree}>
          {children}
        </DynamicDocsLayout>
      </div>
    </div>
  );
}
