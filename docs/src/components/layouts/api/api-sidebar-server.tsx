import { apiSource } from '../../../../lib/source';
import { ApiSidebarContent } from './api-sidebar';

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

// Server component wrapper that fetches the data
export async function ApiSidebar() {
  try {
    // Get all pages from the API source
    const allPages = apiSource.getPages();

    // Filter pages based on section visibility
    const visiblePages = allPages.filter(page => {
      if (page.slugs[0] === 'overview') return true; // Always show overview
      return isSectionVisible(page.slugs[0]);
    });

    // Transform pages to match our expected format
    const transformedPages = visiblePages.map(page => ({
      url: page.url,
      slugs: page.slugs,
      data: {
        title: page.data.title,
        method: getHttpMethod(page)
      }
    }));

    return <ApiSidebarContent pages={transformedPages} />;
  } catch (error) {
    console.error('❌ Error loading API pages:', error);
    return <ApiSidebarContent pages={[]} />;
  }
}
