'use client';

import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { ThemeToggle } from '../../layout/theme-toggle';
import { ScrollArea, ScrollViewport } from '../../ui/scroll-area';

// Types for the page data
type PageData = {
  url: string,
  slugs: string[],
  data: {
    title?: string,
    method?: string,
  },
}

// Types for organized sidebar structure
type OrganizedGroup = {
  title: string,
  pages: PageData[],
}

type OrganizedSection = {
  title: string,
  pages: PageData[],
  groups: Record<string, OrganizedGroup>,
}

// HTTP Method Badge Component
function HttpMethodBadge({ method }: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT' }) {
  const getBadgeStyles = (method: string) => {
    switch (method) {
      case 'GET': {
        return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700';
      }
      case 'POST': {
        return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700';
      }
      case 'PATCH':
      case 'PUT': {
        return 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700';
      }
      case 'DELETE': {
        return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700';
      }
      default: {
        return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-700';
      }
    }
  };

  return (
    <span className={`inline-flex items-center justify-center px-1 py-0.5 rounded text-[10px] font-medium border ${getBadgeStyles(method)} leading-none w-10 flex-shrink-0`}>
      {method}
    </span>
  );
}

// Custom Link Component for API sidebar
function ApiSidebarLink({
  href,
  children,
  method
}: {
  href: string,
  children: ReactNode,
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
}) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
        isActive
          ? 'bg-fd-primary/10 text-fd-primary font-medium'
          : 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50'
      }`}
    >
      {method && <HttpMethodBadge method={method} />}
      <span className="flex-1">{children}</span>
    </Link>
  );
}

// Custom separator component
function ApiSeparator({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 mb-3 first:mt-2">
      <span className="text-xs font-bold text-fd-foreground uppercase tracking-wider">
        {children}
      </span>
    </div>
  );
}

// Custom collapsible section component
function CollapsibleSection({
  title,
  children,
  defaultOpen = false
}: {
  title: string,
  children: ReactNode,
  defaultOpen?: boolean,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="space-y-1">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm font-medium text-fd-muted-foreground hover:text-fd-foreground transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {title}
      </button>
      {isOpen && (
        <div className="ml-4 space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}

// Helper function to extract HTTP method from filename
function extractMethodFromFilename(filename: string): 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT' | undefined {
  const name = filename.replace('.mdx', '');
  if (name.includes('-get')) return 'GET';
  if (name.includes('-post')) return 'POST';
  if (name.includes('-patch')) return 'PATCH';
  if (name.includes('-delete')) return 'DELETE';
  if (name.includes('-put')) return 'PUT';
  return undefined;
}

// Helper function to format title from filename
function formatTitle(filename: string): string {
  const name = filename.replace('.mdx', '');
  // Remove method suffix and format
  const cleanName = name
    .replace(/-get$|-post$|-patch$|-delete$|-put$/, '')
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return cleanName;
}

// Helper function to format section title
function formatSectionTitle(sectionName: string): string {
  return sectionName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Helper function to get display title for API section
function getApiSectionTitle(sectionName: string): string {
  const titleMap: Record<string, string> = {
    'client': 'Client API',
    'server': 'Server API',
    'admin': 'Admin API',
    'webhooks': 'Webhooks'
  };

  return titleMap[sectionName] || formatSectionTitle(sectionName);
}

// Helper function to get HTTP method from page data or filename
function getHttpMethod(page: PageData): 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT' | undefined {
  // First try to get method from frontmatter
  if (page.data.method) {
    const method = page.data.method.toUpperCase();
    if (['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) {
      return method as 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
    }
  }

  // Fallback to filename extraction
  return extractMethodFromFilename(page.slugs[page.slugs.length - 1]);
}

// Client component for API sidebar content
export function ApiSidebarContent({ pages = [] }: { pages?: PageData[] }) {
  const organizedPages = useMemo(() => {
    const organized: Record<string, OrganizedSection> = {};

    pages.forEach(page => {
      // Skip overview page, we handle it separately
      if (page.slugs[0] === 'overview') return;

      const [section, ...rest] = page.slugs;

      // Initialize section using nullish coalescing
      organized[section] ??= {
        title: getApiSectionTitle(section),
        pages: [],
        groups: {}
      };

      if (rest.length === 1) {
        // This is a top-level page for the section (section/page)
        organized[section].pages.push(page);
      } else if (rest.length >= 2) {
        // This is a group page - use the first segment as the group name
        const groupName = rest[0];
        organized[section].groups[groupName] ??= {
          title: formatSectionTitle(groupName),
          pages: []
        };
        organized[section].groups[groupName].pages.push(page);
      }
    });

    return organized;
  }, [pages]);

  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-1">
        <ScrollViewport className="p-4 space-y-1">
          <Link
            href="/docs"
            className="flex items-center gap-2 px-2 py-1.5 mb-2 text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to docs
          </Link>

          <ApiSidebarLink href="/api/overview">
            Overview
          </ApiSidebarLink>

          {Object.entries(organizedPages)
            .filter(([sectionKey]) => sectionKey !== 'admin') // Hide admin section from sidebar
            .sort(([aKey], [bKey]) => {
              // Define the desired order of sections
              const sectionOrder = ['client', 'server', 'webhooks'];
              const aIndex = sectionOrder.indexOf(aKey);
              const bIndex = sectionOrder.indexOf(bKey);
              // If both sections are in our defined order, sort by that order
              if (aIndex !== -1 && bIndex !== -1) {
                return aIndex - bIndex;
              }
              // If only one is in our defined order, prioritize it
              if (aIndex !== -1) return -1;
              if (bIndex !== -1) return 1;
              // If neither is in our defined order, sort alphabetically
              //eslint-disable-next-line
              return aKey.localeCompare(bKey);
            })
            .map(([sectionKey, section]) => (
              <div key={sectionKey} className="mb-4">
                <ApiSeparator>{section.title}</ApiSeparator>

                {/* Section-level pages */}
                {section.pages.length > 0 && section.pages.map((page: PageData) => (
                  <ApiSidebarLink
                    key={page.url}
                    href={page.url}
                    method={getHttpMethod(page)}
                  >
                    {page.data.title || formatTitle(page.slugs[page.slugs.length - 1])}
                  </ApiSidebarLink>
                ))}

                {/* Grouped pages */}
                {Object.entries(section.groups).map(([groupKey, group]: [string, OrganizedGroup]) => (
                  <CollapsibleSection key={groupKey} title={group.title}>
                    {group.pages.map((page: PageData) => {
                      const method = getHttpMethod(page);
                      const title = page.data.title || formatTitle(page.slugs[page.slugs.length - 1]);

                      // Special handling for webhooks (EVENT badge instead of HTTP method)
                      if (sectionKey === 'webhooks') {
                        return (
                          <ApiSidebarLink key={page.url} href={page.url}>
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium border bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700 leading-none">
                                EVENT
                              </span>
                              <span>{title}</span>
                            </div>
                          </ApiSidebarLink>
                        );
                      }

                      return (
                        <ApiSidebarLink
                          key={page.url}
                          href={page.url}
                          method={method}
                        >
                          {title}
                        </ApiSidebarLink>
                      );
                    })}
                  </CollapsibleSection>
                ))}
              </div>
            ))}
        </ScrollViewport>
      </ScrollArea>

      {/* Footer with theme toggle */}
      <div className="border-t border-fd-border p-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-fd-muted-foreground">Stack Auth API</span>
          <ThemeToggle mode="light-dark" />
        </div>
      </div>
    </div>
  );
}
