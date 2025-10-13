import { APIPageWrapper } from '@/components/api/api-page-wrapper';
import { AuthPanel } from '@/components/api/auth-panel';
import { AIChatDrawer } from '@/components/chat/ai-chat';
import { ApiSidebar } from '@/components/layouts/api/api-sidebar-server';
import { DocsHeaderWrapper } from '@/components/layouts/docs-header-wrapper';
import { SharedContentLayout } from '@/components/layouts/shared-content-layout';
import { SidebarProvider } from '@/components/layouts/sidebar-context';
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
    <SidebarProvider>
      <APIPageWrapper>
        <div className="mx-auto">
          <div className="flex flex-col min-h-screen bg-fd-background">
            {/* Full-width header with Stack Auth branding */}
            <DocsHeaderWrapper
              showSearch={false}
              apiPages={apiPages}
            />

            {/* Main layout container with centered content */}
            <div>
              <main className="flex flex-1 flex-row min-w-0 items-start mx-auto w-full max-w-[var(--spacing-fd-container)]">
                {/* Custom API Sidebar - positioned under header, hidden on mobile */}
                <div className="hidden md:block sticky left-0 top-14 lg:top-26 z-30 transition-all duration-300 ease-out w-64">
                  <div className="h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-6.5rem)] flex flex-col">
                    <ApiSidebar />
                  </div>
                </div>

                {/* Main content area */}
                <div className="flex-1 transition-all duration-300 min-w-0">
                  <SharedContentLayout className="prose prose-neutral dark:prose-invert max-w-none">
                    {children}
                  </SharedContentLayout>
                </div>
              </main>
            </div>

            {/* AI Chat Drawer */}
            <AIChatDrawer />

            {/* Auth Panel */}
            <AuthPanel />
          </div>
        </div>
      </APIPageWrapper>
    </SidebarProvider>
  );
}
