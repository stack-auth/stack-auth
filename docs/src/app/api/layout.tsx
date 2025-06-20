import { ApiSidebar } from '@/components/layouts/api/api-sidebar-server';
import { DocsHeaderWrapper } from '@/components/layouts/docs-header-wrapper';
import { apiSource } from '../../../lib/source';

// Types for the page object structure
type PageData = {
  title: string,
  method?: string,
  _openapi?: {
    method?: string,
  },
}

type Page = {
  slugs: string[],
  data: PageData,
  url: string,
}

// Configuration for which sections to show/hide
const SECTION_VISIBILITY = {
  client: true,
  server: true,
  admin: false,  // Hidden
  webhooks: true,
} as const;

// Helper function to check if a section should be visible
function isSectionVisible(sectionName: string): boolean {
  return SECTION_VISIBILITY[sectionName as keyof typeof SECTION_VISIBILITY] || true;
}

// Helper function to extract HTTP method from filename or frontmatter
function getHttpMethod(page: Page): string | undefined {
  // First try frontmatter _openapi.method
  if (page.data._openapi?.method) {
    return page.data._openapi.method.toUpperCase();
  }

  // Also try direct method field (fallback)
  if (page.data.method) {
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
    url: string,
    slugs: string[],
    data: {
      title?: string,
      method?: string,
    },
  }> = [];

  try {
    const allPages = apiSource.getPages() as Page[];
    const visiblePages = allPages.filter((page: Page) => {
      if (page.slugs[0] === 'overview') return true; // Always show overview
      return isSectionVisible(page.slugs[0]);
    });

    apiPages = visiblePages.map((page: Page) => ({
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
    <div className="flex min-h-screen bg-fd-background">
      {/* Full-width header with Stack Auth branding */}
      <DocsHeaderWrapper
        showSearch={false}
        className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-fd-border flex items-center justify-between px-4 md:px-6 bg-fd-background"
        apiPages={apiPages}
      />

      {/* Custom API Sidebar - positioned under header, hidden on mobile */}
      <div className="hidden md:block w-64 flex-shrink-0 border-r border-fd-border fixed left-0 top-14 h-[calc(100vh-3.5rem)] z-30">
        <ApiSidebar />
      </div>

      {/* Main content area - full width on mobile, with left margin on desktop, accounting for header */}
      <div className="flex-1 flex flex-col min-w-0 md:ml-64 pt-14">
        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
