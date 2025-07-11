'use client';

import { ArrowLeft, ChevronDown, ChevronRight, FileText, Sidebar as SidebarIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../lib/cn';
import { ThemeToggle } from '../../layout/theme-toggle';
import { buttonVariants } from '../../ui/button';
import { ScrollArea, ScrollViewport } from '../../ui/scroll-area';
import { useSidebar } from '../sidebar-context';

// Generic API color scheme (neutral - works well in both light/dark modes)
const API_COLOR = 'rgb(71, 85, 105)'; // Neutral dark gray (good for light mode)
const API_COLOR_LIGHT = 'rgb(148, 163, 184)'; // Lighter neutral gray

// HTTP Method color scheme - matches the HttpMethodBadge colors exactly
const METHOD_COLORS = {
  GET: {
    main: 'rgb(22, 101, 52)', // green-800 (matches badge text color)
    light: 'rgb(134, 239, 172)', // green-300 (matches dark mode badge text)
  },
  POST: {
    main: 'rgb(30, 64, 175)', // blue-800 (matches badge text color)
    light: 'rgb(147, 197, 253)', // blue-300 (matches dark mode badge text)
  },
  DELETE: {
    main: 'rgb(153, 27, 27)', // red-800 (matches badge text color)
    light: 'rgb(252, 165, 165)', // red-300 (matches dark mode badge text)
  },
  PATCH: {
    main: 'rgb(154, 52, 18)', // orange-800 (matches badge text color)
    light: 'rgb(253, 186, 116)', // orange-300 (matches dark mode badge text)
  },
  PUT: {
    main: 'rgb(154, 52, 18)', // orange-800 (same as PATCH)
    light: 'rgb(253, 186, 116)', // orange-300 (same as PATCH)
  },
} as const;

// Helper function to get colors based on HTTP method
function getMethodColors(method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'): { main: string, light: string } {
  if (method === undefined) return { main: API_COLOR, light: API_COLOR_LIGHT };
  return METHOD_COLORS[method];
}

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

// Enhanced types for hierarchical structure
type CollapsedItem = {
  type: 'page' | 'section' | 'separator',
  href?: string,
  title: string,
  level: number,
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  children?: CollapsedItem[],
  isCollapsible?: boolean,
  defaultOpen?: boolean,
}

// Context for persisting accordion state
type AccordionContextType = {
  accordionState: Record<string, boolean>,
  setAccordionState: (key: string, isOpen: boolean) => void,
}

const AccordionContext = createContext<AccordionContextType | null>(null);

function AccordionProvider({ children }: { children: ReactNode }) {
  const [accordionState, setAccordionStateInternal] = useState<Record<string, boolean>>({});

  const setAccordionState = (key: string, isOpen: boolean) => {
    setAccordionStateInternal(prev => ({ ...prev, [key]: isOpen }));
  };

  return (
    <AccordionContext.Provider value={{ accordionState, setAccordionState }}>
      {children}
    </AccordionContext.Provider>
  );
}

function useAccordionState(key: string, defaultValue: boolean) {
  const context = useContext(AccordionContext);
  if (!context) {
    throw new Error('useAccordionState must be used within AccordionProvider');
  }

  const { accordionState, setAccordionState } = context;
  const isOpen = accordionState[key] ?? defaultValue;

  const setIsOpen = (value: boolean) => {
    setAccordionState(key, value);
  };

  return [isOpen, setIsOpen] as const;
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

// Collapse trigger button
function ApiSidebarCollapseTrigger() {
  const sidebarContext = useSidebar();
  const { isMainSidebarCollapsed, toggleMainSidebar } = sidebarContext || {
    isMainSidebarCollapsed: false,
    toggleMainSidebar: () => {},
  };

  return (
    <button
      type="button"
      onClick={toggleMainSidebar}
      className={cn(
        buttonVariants({
          size: 'sm',
          color: 'outline',
        }),
        'w-full justify-center hover:scale-105 active:scale-95',
      )}
      title={isMainSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      <SidebarIcon className="h-4 w-4" />
      {!isMainSidebarCollapsed && <span className="ml-2">Collapse</span>}
    </button>
  );
}

// Custom Link Component for API sidebar
function ApiSidebarLink({
  href,
  children,
  method,
  isCollapsed = false
}: {
  href: string,
  children: ReactNode,
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  isCollapsed?: boolean,
}) {
  const pathname = usePathname();
  const isActive = pathname === href;

  if (isCollapsed) {
    return (
      <Link
        href={href}
        className={`flex items-center justify-center p-2 rounded-md text-xs transition-colors ${
          isActive
            ? 'bg-fd-primary/10 text-fd-primary'
            : 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50'
        }`}
        title={typeof children === 'string' ? children : href}
      >
        {method ? <HttpMethodBadge method={method} /> : <FileText className="h-4 w-4" />}
      </Link>
    );
  }

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
function ApiSeparator({ children, isCollapsed = false }: { children: ReactNode, isCollapsed?: boolean }) {
  if (isCollapsed) {
    return (
      <div className="flex justify-center py-2">
        <div className="w-6 h-px bg-fd-border" />
      </div>
    );
  }

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
  defaultOpen = false,
  isCollapsed = false,
  sectionKey = ''
}: {
  title: string,
  children: ReactNode,
  defaultOpen?: boolean,
  isCollapsed?: boolean,
  sectionKey?: string,
}) {
  const accordionKey = `section-${sectionKey}-${title.toLowerCase().replace(/\s+/g, '-')}`;
  const [isOpen, setIsOpen] = useAccordionState(accordionKey, defaultOpen);

  if (isCollapsed) {
    return (
      <div className="flex justify-center py-1">
        <div className="w-2 h-2 bg-fd-muted rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm font-medium text-fd-muted-foreground hover:text-fd-foreground"
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

// Collapsed Page Dot Component
function CollapsedPageDot({
  href,
  title,
  method,
  isActive = false
}: {
  href: string,
  title: string,
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  isActive: boolean,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [dotRect, setDotRect] = useState<DOMRect | null>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  // Get colors based on HTTP method
  const { main: methodColor, light: methodColorLight } = getMethodColors(method);

  useEffect(() => {
    if (isHovered && dotRef.current) {
      setDotRect(dotRef.current.getBoundingClientRect());
    }
  }, [isHovered]);

  const tooltipContent = isHovered && dotRect ? (
    <div
      className="fixed px-3 py-2 bg-fd-popover text-fd-popover-foreground text-sm rounded-md shadow-lg border border-fd-border whitespace-nowrap pointer-events-none"
      style={{
        left: dotRect.right + 8,
        top: dotRect.top + (dotRect.height / 2) - 16,
        zIndex: 9999,
      }}
    >
      <div className="font-medium flex items-center gap-2">
        {method && <HttpMethodBadge method={method} />}
        {title}
      </div>
      <div className="text-xs text-fd-muted-foreground mt-1">
        {isActive ? 'Current page' : 'Click to navigate'}
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={dotRef}
      className="group relative flex justify-center"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Link
        href={href}
        className={cn(
          "flex items-center justify-center w-6 h-6 rounded transition-all duration-200",
          "hover:scale-125"
        )}
        title={title}
      >
        <div
          className={cn(
            "w-2 h-2 rounded-full transition-all duration-200",
            isActive
              ? "scale-125"
              : "group-hover:scale-110"
          )}
          style={{
            backgroundColor: isActive ? methodColor : methodColorLight,
            opacity: isActive ? 1 : 0.7
          }}
        />
      </Link>

      {typeof window !== 'undefined' && tooltipContent && createPortal(tooltipContent, document.body)}
    </div>
  );
}

// Collapsed Section Dot Component
function CollapsedSectionDot({
  title,
  href,
  level = 0,
  children,
  defaultOpen = false
}: {
  title: string,
  href?: string,
  level?: number,
  children?: ReactNode,
  defaultOpen?: boolean,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isHovered, setIsHovered] = useState(false);
  const [dotRect, setDotRect] = useState<DOMRect | null>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  const isActive = href ? pathname === href : false;

  useEffect(() => {
    if (isHovered && dotRef.current) {
      setDotRect(dotRef.current.getBoundingClientRect());
    }
  }, [isHovered]);

  const handleNavigation = () => {
    setIsOpen(true);
    if (href) {
      void router.push(href);
    }
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const tooltipContent = isHovered && dotRect ? (
    <div
      className="fixed px-3 py-2 bg-fd-popover text-fd-popover-foreground text-sm rounded-md shadow-lg border border-fd-border whitespace-nowrap pointer-events-none"
      style={{
        left: dotRect.right + 8,
        top: dotRect.top + (dotRect.height / 2) - 16,
        zIndex: 9999,
      }}
    >
      <div className="font-medium">{title}</div>
      <div className="text-xs text-fd-muted-foreground mt-1">
        {isOpen ? 'Expanded' : 'Collapsed'}
        {isActive && <span className="text-fd-primary"> • Active</span>}
      </div>
    </div>
  ) : null;

  return (
    <>
      <div
        ref={dotRef}
        className="group relative flex items-center justify-center"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ marginLeft: level * 8 }}
      >
        {isOpen ? (
          <>
            <button
              onClick={handleNavigation}
              className={cn(
                "flex items-center justify-center w-6 h-6 rounded transition-all duration-200",
                "hover:scale-110"
              )}
            >
              <div
                className="w-2 h-2 rounded-full transition-all duration-200"
                style={{
                  backgroundColor: isActive ? API_COLOR : API_COLOR_LIGHT,
                  opacity: isActive ? 1 : 0.7
                }}
              />
            </button>

            <button
              onClick={handleToggle}
              className={cn(
                "flex items-center justify-center w-4 h-4 rounded transition-all duration-200 ml-1",
                "hover:scale-110 opacity-60 hover:opacity-100"
              )}
            >
              <div
                className="w-2 h-2 rounded transition-all duration-200 flex items-center justify-center rotate-90"
                style={{
                  backgroundColor: `${API_COLOR}20`,
                  border: `1px solid ${API_COLOR}`,
                }}
              >
                <ChevronRight
                  className="w-1.5 h-1.5"
                  style={{ color: API_COLOR }}
                />
              </div>
            </button>
          </>
        ) : (
          <button
            onClick={handleNavigation}
            className={cn(
              "flex items-center justify-center w-6 h-6 rounded transition-all duration-200",
              "hover:scale-110"
            )}
          >
            <div
              className="w-3 h-3 rounded-full transition-all duration-200 flex items-center justify-center relative"
              style={{
                backgroundColor: isActive ? API_COLOR : `${API_COLOR}20`,
                border: `1px solid ${API_COLOR}`,
              }}
            >
              <ChevronRight
                className="w-2 h-2"
                style={{ color: isActive ? 'white' : API_COLOR }}
              />
            </div>
          </button>
        )}

        {typeof window !== 'undefined' && tooltipContent && createPortal(tooltipContent, document.body)}
      </div>

      {isOpen && children}
    </>
  );
}

// Collapsed Separator Dot Component
function CollapsedSeparatorDot({
  title,
  level = 0,
  sectionItems = []
}: {
  title: string,
  level?: number,
  sectionItems?: string[],
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [dotRect, setDotRect] = useState<DOMRect | null>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isHovered && dotRef.current) {
      setDotRect(dotRef.current.getBoundingClientRect());
    }
  }, [isHovered]);

  const tooltipContent = isHovered && dotRect && sectionItems.length > 0 ? (
    <div
      className="fixed px-4 py-3 bg-fd-popover text-fd-popover-foreground text-sm rounded-lg shadow-lg border border-fd-border pointer-events-none min-w-[200px] max-w-[300px]"
      style={{
        left: dotRect.right + 8,
        top: dotRect.top + (dotRect.height / 2) - 20,
        zIndex: 9999,
      }}
    >
      <div className="font-semibold mb-2" style={{ color: API_COLOR }}>
        {title}
      </div>
      <div className="space-y-1">
        {sectionItems.slice(0, 6).map((item, index) => (
          <div key={index} className="text-xs text-fd-muted-foreground flex items-center gap-2">
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: API_COLOR_LIGHT, opacity: 0.8 }}
            />
            {item}
          </div>
        ))}
        {sectionItems.length > 6 && (
          <div className="text-xs text-fd-muted-foreground opacity-75 mt-2">
            +{sectionItems.length - 6} more items
          </div>
        )}
      </div>
      <div className="text-xs text-fd-muted-foreground mt-2 opacity-75">
        {sectionItems.length} item{sectionItems.length !== 1 ? 's' : ''}
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={dotRef}
      className="flex items-center justify-center py-3 cursor-help"
      style={{ marginLeft: level * 8 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={cn(
          "w-8 h-1 rounded-full opacity-75 transition-all duration-200",
          isHovered && "opacity-100 scale-110"
        )}
        style={{ backgroundColor: API_COLOR_LIGHT }}
      />

      {typeof window !== 'undefined' && tooltipContent && createPortal(tooltipContent, document.body)}
    </div>
  );
}

// Main hierarchical item renderer
function CollapsedHierarchicalItem({
  item,
  nextItems = []
}: {
  item: CollapsedItem,
  nextItems?: CollapsedItem[],
}) {
  const pathname = usePathname();

  if (item.type === 'separator') {
    const sectionItems: string[] = [];
    for (const nextItem of nextItems) {
      if (nextItem.type === 'separator') break;
      if (nextItem.type === 'page') {
        sectionItems.push(nextItem.title);
      } else {
        sectionItems.push(nextItem.title);
        if (nextItem.children) {
          nextItem.children.slice(0, 2).forEach(child => {
            if (child.type === 'page') {
              sectionItems.push(`  ${child.title}`);
            }
          });
          if (nextItem.children.length > 2) {
            sectionItems.push(`  +${nextItem.children.length - 2} more`);
          }
        }
      }
    }

    return (
      <CollapsedSeparatorDot
        title={item.title}
        level={item.level}
        sectionItems={sectionItems}
      />
    );
  }

  if (item.type === 'section' && item.children) {
    return (
      <CollapsedSectionDot
        title={item.title}
        href={item.href}
        level={item.level}
        defaultOpen={item.defaultOpen}
      >
        {item.children.map((child, index) => (
          <CollapsedHierarchicalItem
            key={child.href || `${child.title}-${index}`}
            item={child}
          />
        ))}
      </CollapsedSectionDot>
    );
  }

  return (
    <div style={{ marginLeft: item.level * 8 }}>
      <CollapsedPageDot
        href={item.href!}
        title={item.title}
        method={item.method}
        isActive={pathname === item.href}
      />
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
  if (page.data.method) {
    const method = page.data.method.toUpperCase();
    if (['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) {
      return method as 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
    }
  }

  return extractMethodFromFilename(page.slugs[page.slugs.length - 1]);
}

// Convert organized pages to hierarchical structure for collapsed view
function convertToHierarchicalStructure(organizedPages: Record<string, OrganizedSection>): CollapsedItem[] {
  const items: CollapsedItem[] = [];

  Object.entries(organizedPages)
    .sort(([aKey], [bKey]) => {
      const sectionOrder = ['client', 'server', 'webhooks'];
      const aIndex = sectionOrder.indexOf(aKey);
      const bIndex = sectionOrder.indexOf(bKey);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      // Simple comparison instead of localeCompare
      // eslint-disable-next-line no-restricted-syntax
      return aKey.localeCompare(bKey);
    })
    .forEach(([, section]) => {
      // Add section separator
      items.push({
        type: 'separator',
        title: section.title,
        level: 0,
      });

      // Add section-level pages
      section.pages.forEach(page => {
        items.push({
          type: 'page',
          href: page.url,
          title: page.data.title || formatTitle(page.slugs[page.slugs.length - 1]),
          level: 0,
          method: getHttpMethod(page),
        });
      });

      // Add grouped pages
      Object.entries(section.groups).forEach(([, group]) => {
        const groupChildren: CollapsedItem[] = group.pages.map(page => ({
          type: 'page' as const,
          href: page.url,
          title: page.data.title || formatTitle(page.slugs[page.slugs.length - 1]),
          level: 1,
          method: getHttpMethod(page),
        }));

        items.push({
          type: 'section',
          title: group.title,
          level: 0,
          children: groupChildren,
          isCollapsible: true,
          defaultOpen: false,
        });
      });
    });

  return items;
}

// Client component for API sidebar content
export function ApiSidebarContent({ pages = [] }: { pages?: PageData[] }) {
  const sidebarContext = useSidebar();
  const { isMainSidebarCollapsed } = sidebarContext || {
    isMainSidebarCollapsed: false,
  };

  const organizedPages = useMemo(() => {
    const organized: Record<string, OrganizedSection> = {};

    pages.forEach(page => {
      if (page.slugs[0] === 'overview') return;

      const [section, ...rest] = page.slugs;

      organized[section] ??= {
        title: getApiSectionTitle(section),
        pages: [],
        groups: {}
      };

      if (rest.length === 1) {
        organized[section].pages.push(page);
      } else if (rest.length >= 2) {
        const groupName = rest[0];
        organized[section].groups[groupName] ??= {
          title: formatSectionTitle(groupName),
          pages: []
        };
        organized[section].groups[groupName].pages.push(page);
      }
    });

    // Sort pages and groups alphabetically within each section
    Object.values(organized).forEach(section => {
      // Sort pages within section alphabetically by title
      section.pages.sort((a, b) => {
        const titleA = a.data.title || formatTitle(a.slugs[a.slugs.length - 1]);
        const titleB = b.data.title || formatTitle(b.slugs[b.slugs.length - 1]);
        // eslint-disable-next-line no-restricted-syntax
        return titleA.localeCompare(titleB);
      });

      // Sort groups within section alphabetically by title, and pages within each group
      Object.values(section.groups).forEach(group => {
        group.pages.sort((a, b) => {
          const titleA = a.data.title || formatTitle(a.slugs[a.slugs.length - 1]);
          const titleB = b.data.title || formatTitle(b.slugs[b.slugs.length - 1]);
          // eslint-disable-next-line no-restricted-syntax
          return titleA.localeCompare(titleB);
        });
      });

      // Sort the groups themselves alphabetically by title
      const sortedGroups = Object.entries(section.groups).sort(([, groupA], [, groupB]) => {
        // eslint-disable-next-line no-restricted-syntax
        return groupA.title.localeCompare(groupB.title);
      });

      // Replace the groups object with sorted entries
      section.groups = Object.fromEntries(sortedGroups);
    });

    return organized;
  }, [pages]);

  const hierarchicalItems = useMemo(() => {
    return convertToHierarchicalStructure(organizedPages);
  }, [organizedPages]);

  return (
    <AccordionProvider>
      <div className="h-full flex flex-col">
        <ScrollArea className="flex-1">
          <ScrollViewport className={`space-y-1 ${isMainSidebarCollapsed ? 'p-2' : 'p-4'}`}>
            {!isMainSidebarCollapsed && (
              <Link
                href="/docs"
                className="flex items-center gap-2 px-2 py-1.5 mb-2 text-sm text-fd-muted-foreground hover:text-fd-foreground"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to docs
              </Link>
            )}

            <ApiSidebarLink href="/api/overview" isCollapsed={isMainSidebarCollapsed}>
              Overview
            </ApiSidebarLink>

            {isMainSidebarCollapsed ? (
              // Collapsed view - hierarchical dots
              <div className="flex flex-col items-start space-y-2 py-4 w-full">
                <div className="flex flex-col space-y-1 w-full">
                  {hierarchicalItems.map((item, index) => (
                    <CollapsedHierarchicalItem
                      key={item.href || `${item.title}-${index}`}
                      item={item}
                      nextItems={hierarchicalItems.slice(index + 1)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              // Expanded view - original layout
              Object.entries(organizedPages)
                .filter(([sectionKey]) => sectionKey !== 'admin')
                .sort(([aKey], [bKey]) => {
                  const sectionOrder = ['client', 'server', 'webhooks'];
                  const aIndex = sectionOrder.indexOf(aKey);
                  const bIndex = sectionOrder.indexOf(bKey);
                  if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                  if (aIndex !== -1) return -1;
                  if (bIndex !== -1) return 1;
                  // eslint-disable-next-line no-restricted-syntax
                  return aKey.localeCompare(bKey);
                })
                .map(([sectionKey, section]) => (
                  <div key={sectionKey} className="mb-4">
                    <ApiSeparator isCollapsed={isMainSidebarCollapsed}>{section.title}</ApiSeparator>

                    {section.pages.length > 0 && section.pages.map((page: PageData) => (
                      <ApiSidebarLink
                        key={page.url}
                        href={page.url}
                        method={getHttpMethod(page)}
                        isCollapsed={isMainSidebarCollapsed}
                      >
                        {page.data.title || formatTitle(page.slugs[page.slugs.length - 1])}
                      </ApiSidebarLink>
                    ))}

                    {Object.entries(section.groups).map(([groupKey, group]: [string, OrganizedGroup]) => (
                      <CollapsibleSection key={groupKey} title={group.title} isCollapsed={isMainSidebarCollapsed} sectionKey={sectionKey}>
                        {group.pages.map((page: PageData) => {
                          const method = getHttpMethod(page);
                          const title = page.data.title || formatTitle(page.slugs[page.slugs.length - 1]);

                          if (sectionKey === 'webhooks') {
                            return (
                              <ApiSidebarLink key={page.url} href={page.url} isCollapsed={isMainSidebarCollapsed}>
                                {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
                                {!isMainSidebarCollapsed ? (
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium border bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700 leading-none">
                                      EVENT
                                    </span>
                                    <span>{title}</span>
                                  </div>
                                ) : (
                                  '🔔'
                                )}
                              </ApiSidebarLink>
                            );
                          }

                          return (
                            <ApiSidebarLink
                              key={page.url}
                              href={page.url}
                              method={method}
                              isCollapsed={isMainSidebarCollapsed}
                            >
                              {title}
                            </ApiSidebarLink>
                          );
                        })}
                      </CollapsibleSection>
                    ))}
                  </div>
                ))
            )}
          </ScrollViewport>
        </ScrollArea>

        {/* Footer with theme toggle and collapse button */}
        <div className="border-t border-fd-border p-4 flex-shrink-0">
          {isMainSidebarCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <ApiSidebarCollapseTrigger />
              <ThemeToggle mode="light-dark" />
            </div>
          ) : (
            <div className="space-y-2">
              <ApiSidebarCollapseTrigger />
              <div className="flex items-center justify-between">
                <span className="text-xs text-fd-muted-foreground">Stack Auth API</span>
                <ThemeToggle mode="light-dark" />
              </div>
            </div>
          )}
        </div>
      </div>
    </AccordionProvider>
  );
}
