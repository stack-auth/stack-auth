import { AIChatDrawer } from '@/components/chat/ai-chat';
import { DocsHeaderWrapper } from '@/components/layouts/docs-header-wrapper';
import { SidebarProvider } from '@/components/layouts/sidebar-context';
import { dashboardSource } from 'lib/source';

// Types for the page object structure
type PageData = {
  title: string,
}

type Page = {
  slugs: string[],
  data: PageData,
  url: string,
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Fetch dashboard pages data for navigation
  let dashboardPages: Array<{
    url: string,
    slugs: string[],
    data: {
      title?: string,
    },
  }> = [];

  try {
    const allPages = dashboardSource.getPages() as Page[];
    dashboardPages = allPages.map((page: Page) => ({
      url: page.url,
      slugs: page.slugs,
      data: {
        title: page.data.title,
      }
    }));
  } catch (error) {
    console.error('❌ Error loading dashboard pages for navigation:', error);
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-fd-background">
        {/* Full-width header with Stack Auth branding */}
        <DocsHeaderWrapper
          showSearch={false}
          className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-fd-border flex items-center justify-between px-4 md:px-6 bg-fd-background"
        />

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0 pt-14" id="dashboard-main-content">
          {/* Page content */}
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>

        {/* AI Chat Drawer */}
        <AIChatDrawer />
      </div>
    </SidebarProvider>
  );
}
