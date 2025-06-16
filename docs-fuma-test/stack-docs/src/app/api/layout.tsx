import { baseOptions } from '@/app/layout.config';
import { ApiSidebar } from '@/components/layouts/api/api-sidebar-server';
import { DocsHeaderWrapper } from '@/components/layouts/docs-header-wrapper';
import Link from 'next/link';
import { apiSource } from '../../../lib/source';

// Configuration for which sections to show/hide
const SECTION_VISIBILITY = {
  client: true,
  server: true, 
  admin: false,  // Hidden
  webhooks: true,
} as const;

// Helper function to check if a section should be visible
function isSectionVisible(sectionName: string): boolean {
  return SECTION_VISIBILITY[sectionName as keyof typeof SECTION_VISIBILITY] ?? true;
}

// Helper function to extract HTTP method from filename or frontmatter
function getHttpMethod(page: any): string | undefined {
  // First try frontmatter _openapi.method
  if (page.data?._openapi?.method) {
    return page.data._openapi.method.toUpperCase();
  }
  
  // Also try direct method field (fallback)
  if (page.data?.method) {
    return page.data.method.toUpperCase();
  }
  
  // Fallback to filename
  const filename = page.slugs[page.slugs.length - 1];
  if (filename.includes('-get')) return 'GET';
  if (filename.includes('-post')) return 'POST';
  if (filename.includes('-patch')) return 'PATCH';
  if (filename.includes('-delete')) return 'DELETE';
  if (filename.includes('-put')) return 'PUT';
  
  return undefined;
}

export default function ApiLayout({ children }: { children: React.ReactNode }) {
  // Fetch API pages data for mobile navigation
  let apiPages: Array<{
    url: string;
    slugs: string[];
    data: {
      title?: string;
      method?: string;
    };
  }> = [];
  
  try {
    const allPages = apiSource.getPages();
    const visiblePages = allPages.filter((page: any) => {
      if (page.slugs[0] === 'overview') return true; // Always show overview
      return isSectionVisible(page.slugs[0]);
    });
    
    apiPages = visiblePages.map((page: any) => ({
      url: page.url,
      slugs: page.slugs,
      data: {
        title: page.data.title,
        method: getHttpMethod(page)
      }
    }));
  } catch (error) {
    console.error('❌ Error loading API pages for mobile navigation:', error);
  }

  return (
    <div className="flex h-screen bg-fd-background">
      {/* Custom API Sidebar - hidden on mobile, shown on desktop */}
      <div className="hidden md:block w-64 flex-shrink-0 border-r border-fd-border">
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="h-14 px-4 border-b border-fd-border flex items-center">
            <Link
              href="/"
              className="inline-flex text-[15px] items-center gap-2.5 font-medium"
            >
              {baseOptions.nav?.title}
            </Link>
          </div>
          
          {/* API Sidebar Content */}
          <div className="flex-1 overflow-hidden">
            <ApiSidebar />
          </div>
        </div>
      </div>

      {/* Main content area - full width on mobile, with left margin on desktop */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Docs Header Wrapper - provides API sidebar content to mobile navigation */}
        <DocsHeaderWrapper 
          showSearch={false}
          className="h-14 border-b border-fd-border flex items-center px-6 relative overflow-hidden"
          apiPages={apiPages}
        />

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <div className="container max-w-6xl mx-auto px-6 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
} 
