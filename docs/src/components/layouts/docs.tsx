/**
 * DOCS BASE LAYOUT
 *
 * This file contains the core documentation layout structure and styling.
 * It provides the foundational DocsLayout component that handles the actual
 * rendering of the documentation interface.
 *
 * ARCHITECTURE:
 * 1. app/docs/layout.tsx
 *    ↓ imports DynamicDocsLayout
 * 2. docs-layout-router.tsx (ROUTER)
 *    ↓ routes to appropriate config → imports DocsLayout
 * 3. docs.tsx (THIS FILE - BASE LAYOUT)
 *    ↓ renders the actual layout structure
 *
 * RESPONSIBILITIES:
 * - Core layout structure (sidebar, main content, navigation)
 * - Sidebar rendering with custom content injection
 * - Platform tab integration
 * - Page tree navigation for general docs
 * - Theme and responsive behavior
 *
 * EXPORTED COMPONENTS:
 * - DocsLayout: Main layout component used by router
 * - SdkSidebarContent: SDK-specific navigation content
 * - DocsLayoutSidebar: Fixed sidebar with custom content support
 * - DocsLayoutSidebarFooter: Sidebar footer with theme toggle
 *
 * CUSTOM UI COMPONENTS:
 * - DocsSidebarLink: Styled navigation links
 * - DocsSeparator: Section dividers
 * - CollapsibleSection: Expandable navigation groups
 * - PageTreeItem: Recursive page tree rendering
 */

"use client";

import Link from 'fumadocs-core/link';
import type { PageTree } from 'fumadocs-core/server';
import {
  NavProvider,
  StylesProvider,
  type PageStyles,
} from 'fumadocs-ui/contexts/layout';
import { TreeContextProvider } from 'fumadocs-ui/contexts/tree';
import { ChevronDown, ChevronRight, Languages, Sidebar as SidebarIcon } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CodeOverlayProvider, useCodeOverlay } from '../../hooks/use-code-overlay';
import { cn } from '../../lib/cn';
import { AIChatDrawer } from '../chat/ai-chat';
import { CustomSearchDialog } from '../layout/custom-search-dialog';
import {
  SearchInputToggle
} from '../layout/custom-search-toggle';
import {
  LanguageToggle,
  LanguageToggleText,
} from '../layout/language-toggle';
import { ThemeToggle } from '../layout/theme-toggle';
import { DynamicCodeblockOverlay } from '../mdx/dynamic-code-block-overlay';
import { buttonVariants } from '../ui/button';
import { HideIfEmpty } from '../ui/hide-if-empty';
import { ScrollArea, ScrollViewport } from '../ui/scroll-area';
import {
  CollapsibleControl,
  Navbar,
  NavbarSidebarTrigger,
} from './docs-client';
import {
  layoutVariables,
  type SidebarOptions
} from './docs/shared';
import {
  BaseLinkItem,
  type IconItemType,
  type LinkItemType,
} from './links';
import { getLinks, omit, slot, slots, type BaseLayoutProps } from './shared';
import { isInApiSection } from './shared-header';
import { useSidebar as useCustomSidebar } from './sidebar-context';

// Import chat context

// Context for persisting accordion state
type AccordionContextType = {
  accordionState: Record<string, boolean>,
  setAccordionState: (key: string, isOpen: boolean) => void,
};

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

// Custom Link Component for docs sidebar - matches API sidebar
function DocsSidebarLink({
  href,
  children,
  external = false,
  icon
}: {
  href: string,
  children: ReactNode,
  external?: boolean,
  icon?: ReactNode,
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
      {...(external && { target: '_blank', rel: 'noopener noreferrer' })}
    >
      {icon && <span className="flex-shrink-0 [&_svg]:size-3.5">{icon}</span>}
      <span className="flex-1">{children}</span>
    </Link>
  );
}

// Custom separator component - matches API sidebar
function DocsSeparator({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 mb-3 first:mt-2">
      <span className="text-xs font-bold text-fd-foreground uppercase tracking-wider">
        {children}
      </span>
    </div>
  );
}

// Custom collapsible section component - matches API sidebar
function CollapsibleSection({
  title,
  children,
  defaultOpen = false
}: {
  title: string,
  children: ReactNode,
  defaultOpen?: boolean,
}) {
  // Use context for persistent state
  const accordionKey = `section-${title.toLowerCase().replace(/\s+/g, '-')}`;
  const [isOpen, setIsOpen] = useAccordionState(accordionKey, defaultOpen);

  return (
    <div className="space-y-1">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 text-xs font-medium text-fd-muted-foreground hover:text-fd-foreground transition-colors"
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

// Clickable collapsible section component - for folders with index pages
function ClickableCollapsibleSection({
  title,
  href,
  children,
  defaultOpen = false
}: {
  title: string,
  href: string,
  children: ReactNode,
  defaultOpen?: boolean,
}) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + '/');

  // Use context for persistent state
  const accordionKey = `collapsible-${href}`;
  const [isOpen, setIsOpen] = useAccordionState(accordionKey, defaultOpen || isActive);

  const containerRef = useRef<HTMLDivElement>(null);

  // Note: Removed outside click detection as it was interfering with navigation
  // The accordion should stay open when user navigates within the section

  return (
    <div className="space-y-1" ref={containerRef}>
      <div className="group">
        <Link
          href={href}
          className={`flex items-center justify-between w-full px-2 py-1.5 rounded-md text-xs transition-colors ${
            isActive
              ? 'bg-fd-primary/10 text-fd-primary font-medium'
              : 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50'
          }`}
          onClick={() => {
            if (!isOpen) {
              setIsOpen(true);
            }
          }}
        >
          <span className="flex-1">{title}</span>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
            className="transition-opacity p-0.5 rounded hover:bg-fd-muted/30"
          >
            {isOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        </Link>
      </div>
      {isOpen && (
        <div className="ml-4 space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}

// Recursive component to render page tree items with API styling
function PageTreeItem({ item }: { item: PageTree.Node }) {
  const pathname = usePathname();

  if (item.type === 'separator') {
    return <DocsSeparator>{item.name}</DocsSeparator>;
  }

  if (item.type === 'folder') {
    const hasIndexPage = 'index' in item && item.index;
    const folderUrl = hasIndexPage ? item.index!.url : '';
    const isCurrentPath = folderUrl && pathname.startsWith(folderUrl);
    const itemName = typeof item.name === 'string' ? item.name : '';

    // If folder has an index page, make the title clickable
    if (hasIndexPage) {
      return (
        <ClickableCollapsibleSection
          title={itemName || 'Folder'}
          href={item.index!.url}
          defaultOpen={!!isCurrentPath}
        >
          {item.children.map((child, index) => (
            <PageTreeItem key={child.type === 'page' ? child.url : index} item={child} />
          ))}
        </ClickableCollapsibleSection>
      );
    }

    // If no index page, use regular accordion trigger
    return (
      <CollapsibleSection
        title={itemName || 'Folder'}
        defaultOpen={!!isCurrentPath}
      >
        {item.children.map((child, index) => (
          <PageTreeItem key={child.type === 'page' ? child.url : index} item={child} />
        ))}
      </CollapsibleSection>
    );
  }

  return (
    <DocsSidebarLink href={item.url} external={item.external} icon={item.icon}>
      {item.name}
    </DocsSidebarLink>
  );
}

// Function to render sidebar content based on context
function renderSidebarContent(tree: PageTree.Root, pathname: string) {
  if (isInApiSection(pathname)) {
    return null;
  }

  return (
    <>
      {tree.children.map((item, index) => (
        <PageTreeItem key={item.type === 'page' ? item.url : index} item={item} />
      ))}
    </>
  );
}

// Enhanced page dot tooltips
function CollapsedPageDot({
  href,
  title,
}: {
  href: string,
  title: string,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [dotRect, setDotRect] = useState<DOMRect | null>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Determine if this page is currently active based on current pathname
  const isCurrentlyActive = pathname === href;

  const platformColor = 'rgb(59, 130, 246)';

  // Update dot position when hovered
  useEffect(() => {
    if (isHovered && dotRef.current) {
      setDotRect(dotRef.current.getBoundingClientRect());
    }
  }, [isHovered]);

  const handleClick = () => {
    router.push(href);
  };

  // Enhanced tooltip with more context
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
        {isCurrentlyActive ? 'Current page' : 'Click to navigate'}
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
      <button
        onClick={handleClick}
        className={cn(
          "flex items-center justify-center w-6 h-6 rounded transition-all duration-200",
          "hover:scale-125"
        )}
        title={title}
      >
        <div
          className={cn(
            "w-2 h-2 rounded-full transition-all duration-200",
            isCurrentlyActive
              ? "scale-125"
              : "group-hover:scale-110"
          )}
          style={{
            backgroundColor: isCurrentlyActive ? platformColor : 'rgb(100, 116, 139)',
            opacity: isCurrentlyActive ? 1 : 0.6,
          }}
        />
      </button>

      {/* Render tooltip as portal to avoid clipping */}
      {typeof window !== 'undefined' && tooltipContent && createPortal(tooltipContent, document.body)}
    </div>
  );
}

// Enhanced types for hierarchical structure
type CollapsedItem = {
  type: 'page' | 'section' | 'separator',
  href?: string,
  title: string,
  level: number, // 0 = top level, 1 = nested, etc.
  children?: CollapsedItem[],
  isCollapsible?: boolean,
  defaultOpen?: boolean,
};

// Section Header Dot Component - for collapsible sections
function CollapsedSectionDot({
  title,
  href,
  level = 0,
  items = [],
  defaultOpen = false
}: {
  title: string,
  href?: string,
  level?: number,
  items?: CollapsedItem[],
  defaultOpen?: boolean,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isHovered, setIsHovered] = useState(false);
  const [dotRect, setDotRect] = useState<DOMRect | null>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Determine if this section is currently active based on current pathname
  const isActive = href ? pathname === href : false;

  const platformColor = 'rgb(59, 130, 246)';

  useEffect(() => {
    if (isHovered && dotRef.current) {
      setDotRect(dotRef.current.getBoundingClientRect());
    }
  }, [isHovered]);

  const handleNavigation = () => {
    setIsOpen(true);

    if (href) {
      router.push(href);
    }
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  // Enhanced tooltip with more context
  const itemsCount = items.length;
  const tooltipText = href
    ? `${title} (${itemsCount} items) - Click to open section`
    : `${title} section (${itemsCount} items)`;

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
        {itemsCount} item{itemsCount !== 1 ? 's' : ''} • {isOpen ? 'Expanded' : 'Collapsed'}
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
          // Expanded state: show navigation dot + close button
          <>
            {/* Main navigation dot */}
            <button
              onClick={handleNavigation}
              className={cn(
                "flex items-center justify-center w-6 h-6 rounded transition-all duration-200",
                "hover:scale-110"
              )}
              title={`Go to ${title}`}
            >
              <div
                key={`${title}-${pathname}-${isActive}`}
                className="w-2 h-2 rounded-full transition-all duration-200"
                style={{
                  backgroundColor: isActive ? platformColor : 'rgb(100, 116, 139)',
                  opacity: isActive ? 1 : 0.6
                }}
              />
            </button>

            {/* Close button */}
            <button
              onClick={handleToggle}
              className={cn(
                "flex items-center justify-center w-4 h-4 rounded transition-all duration-200 ml-1",
                "hover:scale-110 opacity-60 hover:opacity-100"
              )}
              title={`Collapse ${title}`}
            >
              <div
                className="w-2 h-2 rounded transition-all duration-200 flex items-center justify-center rotate-90"
                style={{
                  backgroundColor: `${platformColor}40`,
                  border: `1px solid ${platformColor}`,
                }}
              >
                <ChevronRight
                  className="w-1.5 h-1.5"
                  style={{ color: platformColor }}
                />
              </div>
            </button>
          </>
        ) : (
          // Collapsed state: show centered dot with internal indicator
          <button
            onClick={handleNavigation}
            className={cn(
              "flex items-center justify-center w-6 h-6 rounded transition-all duration-200",
              "hover:scale-110"
            )}
            title={tooltipText}
          >
            <div
              key={`${title}-collapsed-${pathname}-${isActive}`}
              className="w-3 h-3 rounded-full transition-all duration-200 flex items-center justify-center relative"
              data-active={isActive}
              style={{
                backgroundColor: isActive ? platformColor : `${platformColor}40`,
                border: `1px solid ${platformColor}`,
              }}
            >
              {/* Internal indicator - small chevron */}
              <ChevronRight
                key={`${title}-chevron-${pathname}-${isActive}`}
                className="w-2 h-2"
                style={{ color: isActive ? 'white' : platformColor }}
              />
            </div>
          </button>
        )}

        {typeof window !== 'undefined' && tooltipContent && createPortal(tooltipContent, document.body)}
      </div>

      {/* Render items when expanded */}
      {isOpen && items.map((child, index) => (
        <CollapsedHierarchicalItem
          key={child.href || `${child.title}-${index}`}
          item={child}
          nextItems={[]}
        />
      ))}
    </>
  );
}

// Enhanced Separator Dot Component - with hover tooltip showing section contents
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

  const platformColor = 'rgb(59, 130, 246)';

  // Update position when hovered
  useEffect(() => {
    if (isHovered && dotRef.current) {
      setDotRect(dotRef.current.getBoundingClientRect());
    }
  }, [isHovered]);

  // Enhanced tooltip with section contents
  const tooltipContent = isHovered && dotRect && sectionItems.length > 0 ? (
    <div
      className="fixed px-4 py-3 bg-fd-popover text-fd-popover-foreground text-sm rounded-lg shadow-lg border border-fd-border pointer-events-none min-w-[200px] max-w-[300px]"
      style={{
        left: dotRect.right + 8,
        top: dotRect.top + (dotRect.height / 2) - 20,
        zIndex: 9999,
      }}
    >
      <div className="font-semibold mb-2" style={{ color: platformColor }}>
        {title}
      </div>
      <div className="space-y-1">
        {sectionItems.slice(0, 6).map((item, index) => (
          <div key={index} className="text-xs text-fd-muted-foreground flex items-center gap-2">
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: platformColor, opacity: 0.6 }}
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
        style={{ backgroundColor: platformColor }}
      />

      {/* Render tooltip as portal to avoid clipping */}
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

  if (item.type === 'separator') {
    // Find items that come after this separator until the next separator
    const sectionItems: string[] = [];
    for (const nextItem of nextItems) {
      if (nextItem.type === 'separator') break;
      if (nextItem.type === 'page') {
        sectionItems.push(nextItem.title);
      } else {
        // For sections, add the section title and optionally first few children
        sectionItems.push(nextItem.title);
        (nextItem.children ?? []).slice(0, 2).forEach(child => {
          if (child.type === 'page') {
            sectionItems.push(`  ${child.title}`);
          }
        });
        if ((nextItem.children ?? []).length > 2) {
          sectionItems.push(`  +${(nextItem.children ?? []).length - 2} more`);
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
        items={item.children}
        defaultOpen={item.defaultOpen}
      />
    );
  }

  // Regular page dot
  return (
    <div style={{ marginLeft: item.level * 8 }}>
      <CollapsedPageDot
        href={item.href!}
        title={item.title}
      />
    </div>
  );
}

// Function to convert page tree to hierarchical structure
function convertToHierarchicalStructure(nodes: PageTree.Node[], currentPath: string, level: number = 0): CollapsedItem[] {
  const items: CollapsedItem[] = [];

  for (const node of nodes) {
    if (node.type === 'separator') {
      items.push({
        type: 'separator',
        title: String(node.name || 'Section'),
        level,
      });
    } else if (node.type === 'folder') {
      const hasIndexPage = 'index' in node && node.index;
      const folderUrl = hasIndexPage ? node.index!.url : '';
      const isCurrentPath = folderUrl && currentPath.startsWith(folderUrl);
      const itemName = String(node.name || 'Folder');

      const children = convertToHierarchicalStructure(node.children, currentPath, level + 1);

      if (hasIndexPage) {
        // Clickable section with index page
        items.push({
          type: 'section',
          href: folderUrl,
          title: itemName,
          level,
          children,
          isCollapsible: true,
          defaultOpen: !!isCurrentPath,
        });
      } else {
        // Non-clickable section
        items.push({
          type: 'section',
          title: itemName,
          level,
          children,
          isCollapsible: true,
          defaultOpen: !!isCurrentPath,
        });
      }
    } else {
      items.push({
        type: 'page',
        href: node.url,
        title: String(node.name || 'Page'),
        level,
      });
    }
  }

  return items;
}

// Updated collapsed sidebar renderer - uses platform content
function renderCollapsedSidebarContent(tree: PageTree.Root, pathname: string) {
  const hierarchicalItems = convertToHierarchicalStructure(tree.children, pathname);

  return (
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
  );
}

export type DocsLayoutProps = {
  tree: PageTree.Root,

  sidebar?: Partial<SidebarOptions> & {
    enabled?: boolean,
    component?: ReactNode,
  },

  /**
   * Props for the `div` container
   */
  containerProps?: HTMLAttributes<HTMLDivElement>,
} & BaseLayoutProps

export function DocsLayout({
  nav: { transparentMode, ...nav } = {},
  sidebar = {},
  searchToggle,
  disableThemeSwitch = false,
  themeSwitch = { enabled: !disableThemeSwitch },
  i18n = false,
  children,
  ...props
}: DocsLayoutProps): ReactNode {
  const [searchOpen, setSearchOpen] = useState(false);

  const links = getLinks(props.links ?? [], props.githubUrl);

  const variables = cn(
    '[--fd-tocnav-height:36px] [--fd-sidebar-width:268px] [--fd-toc-width:200px]',
    !nav.component && nav.enabled !== false
      ? '[--fd-nav-height:56px] md:[--fd-nav-height:56px]'
      : undefined,
  );

  const pageStyles: PageStyles = {
    tocNav: cn('xl:hidden'),
    toc: cn('max-xl:hidden'),
    article: cn('max-w-none'),
  };

  return (
    <CodeOverlayProvider>
      <AccordionProvider>
        <TreeContextProvider tree={props.tree}>
          <NavProvider transparentMode={transparentMode}>
            {slot(
              nav,
              <Navbar className="h-14 md:hidden">
                <Link
                  href={nav.url ?? '/'}
                  className="inline-flex items-center gap-2.5 font-semibold"
                >
                  {nav.title}
                </Link>
                <div className="flex-1">{nav.children}</div>
                {slots('sm', searchToggle, <SearchInputToggle onOpen={() => setSearchOpen(true)} />)}
                <NavbarSidebarTrigger className="-me-2 md:hidden" />
              </Navbar>,
            )}
            <CustomSearchDialog
              open={searchOpen}
              onOpenChange={setSearchOpen}
            />
            <main
              id="nd-docs-layout"
              {...props.containerProps}
              className={cn(
                'flex flex-1 flex-row min-w-0 items-start',
                variables,
                props.containerProps?.className,
              )}
              style={{
                ...layoutVariables,
                ...props.containerProps?.style,
              }}
            >
              {slot(
                sidebar,
                <DocsLayoutSidebar
                  {...omit(sidebar, 'enabled', 'component', 'tabs')}
                  links={links}
                  tree={props.tree}
                  onSearchOpen={() => setSearchOpen(true)}
                  nav={
                    <>
                      <Link
                        href={nav.url ?? '/'}
                        className="inline-flex text-[15px] items-center gap-2.5 font-medium"
                      >
                        {nav.title}
                      </Link>
                      {nav.children}
                    </>
                  }
                  banner={sidebar.banner}
                  footer={
                    <>
                      <DocsLayoutSidebarFooter
                        links={links.filter((item) => item.type === 'icon')}
                        i18n={i18n}
                        themeSwitch={themeSwitch}
                      />
                      {sidebar.footer}
                    </>
                  }
                />,
              )}
              <div className={cn(
                'flex-1 transition-all duration-300 min-w-0'
              )}>
                <StylesProvider {...pageStyles}>{children}</StylesProvider>
                <CodeOverlayRenderer />
              </div>
            </main>
            <AIChatDrawer />
          </NavProvider>
        </TreeContextProvider>
      </AccordionProvider>
    </CodeOverlayProvider>
  );
}

// Docs Sidebar Collapse Trigger Button
function DocsSidebarCollapseTrigger() {
  const customSidebarContext = useCustomSidebar();
  const { isMainSidebarCollapsed, toggleMainSidebar } = customSidebarContext || {
    isMainSidebarCollapsed: false,
    toggleMainSidebar: () => {},
  };

  return (
    <button
      type="button"
      onClick={toggleMainSidebar}
      className={cn(
        'px-2 py-1 text-xs font-medium rounded-md transition-colors',
        'bg-fd-muted/50 hover:bg-fd-muted text-fd-muted-foreground hover:text-fd-foreground',
        'border border-fd-border/50'
      )}
      title={isMainSidebarCollapsed ? 'Expand sidebar' : 'Zen mode'}
    >
      {isMainSidebarCollapsed ? <SidebarIcon className="h-3 w-3" /> : 'Zen'}
    </button>
  );
}

export function DocsLayoutSidebar({
  collapsible = true,
  banner,
  onSearchOpen,
  ...props
}: Omit<SidebarOptions, 'tabs'> & {
  links?: LinkItemType[],
  nav?: ReactNode,
  tree?: PageTree.Root,
  onSearchOpen?: () => void,
}) {
  const pathname = usePathname();
  const customSidebarContext = useCustomSidebar();
  const { isMainSidebarCollapsed } = customSidebarContext || {
    isMainSidebarCollapsed: false,
  };

  return (
    <>
      {collapsible ? <CollapsibleControl onSearchOpen={onSearchOpen} /> : null}
      {/* Sidebar positioned under the header */}
      <div className={cn(
        "hidden md:block sticky left-0 top-14 lg:top-26 z-30 transition-all duration-300 ease-out",
        isMainSidebarCollapsed ? "w-16" : "w-64"
      )}>
        <div className="h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-6.5rem)] flex flex-col">
          {/* Scrollable content area */}
          <div className="flex-1 min-h-0 pt-4 overflow-hidden">
            <ScrollArea className="h-full">
              <ScrollViewport className={isMainSidebarCollapsed ? "p-2" : "p-4"}>
                {/* Platform tabs/banner */}
                {banner && !isMainSidebarCollapsed && (
                  <div className="mb-4">
                    {banner}
                  </div>
                )}

                {/* Page tree content */}
                <div className="space-y-1">
                  {isMainSidebarCollapsed ? (
                    // Collapsed state - show actual navigation with tooltips
                    renderCollapsedSidebarContent(props.tree || { name: 'root', children: [] } as PageTree.Root, pathname)
                  ) : (
                    renderSidebarContent(props.tree || { name: 'root', children: [] } as PageTree.Root, pathname)
                  )}
                </div>
              </ScrollViewport>
            </ScrollArea>
          </div>

          {/* Footer - with zen button and theme toggle */}
          <div className="border-t border-fd-border p-4 flex-shrink-0">
            {isMainSidebarCollapsed ? (
              <div className="flex flex-col items-center gap-2">
                <DocsSidebarCollapseTrigger />
                <ThemeToggle mode="light-dark" />
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-fd-muted-foreground flex-1">Stack Auth Docs</span>
                <div className="flex items-center gap-2">
                  <DocsSidebarCollapseTrigger />
                  <ThemeToggle mode="light-dark" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export function DocsLayoutSidebarFooter({
  i18n,
  themeSwitch,
  links = [],
}: {
  i18n?: DocsLayoutProps['i18n'],
  links?: IconItemType[],
  themeSwitch?: DocsLayoutProps['themeSwitch'],
}) {
  return (
    <HideIfEmpty>
      <div className="flex items-center justify-end">
        <div className="flex items-center flex-1 empty:hidden">
          {links.map((item, i) => (
            <BaseLinkItem
              key={i}
              item={item}
              className={cn(
                buttonVariants({ size: 'icon', color: 'ghost' }),
                'text-fd-muted-foreground md:[&_svg]:size-4.5',
              )}
              aria-label={item.label}
            >
              {item.icon}
            </BaseLinkItem>
          ))}
        </div>
        {i18n ? (
          <LanguageToggle className="me-1.5">
            <Languages className="size-4.5" />
            <LanguageToggleText className="md:hidden" />
          </LanguageToggle>
        ) : null}
        {slot(
          themeSwitch,
          <ThemeToggle className="p-0" mode={themeSwitch?.mode} />,
        )}
      </div>
    </HideIfEmpty>
  );
}

// Component to render the code overlay
function CodeOverlayRenderer() {
  const { isOpen, code, language, title, closeOverlay } = useCodeOverlay();

  return (
    <DynamicCodeblockOverlay
      isOpen={isOpen}
      code={code}
      language={language}
      title={title}
      onToggle={(open: boolean) => {
        if (!open) closeOverlay();
      }}
    />
  );
}

export { getSidebarTabsFromOptions } from './docs/shared';
export { CollapsibleControl, Navbar, NavbarSidebarTrigger, type LinkItemType };

