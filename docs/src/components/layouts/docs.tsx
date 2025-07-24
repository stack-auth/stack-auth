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

import Link from 'fumadocs-core/link';
import type { PageTree } from 'fumadocs-core/server';
import {
  NavProvider,
  StylesProvider,
  type PageStyles,
} from 'fumadocs-ui/contexts/layout';
import { TreeContextProvider } from 'fumadocs-ui/contexts/tree';
import { ArrowLeft, ChevronDown, ChevronRight, Languages, Sidebar as SidebarIcon } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePlatformPreference } from '../../hooks/use-platform-preference';
import { cn } from '../../lib/cn';
import { getSmartRedirectUrl } from '../../lib/navigation-utils';
import { getSmartPlatformRedirect } from '../../lib/platform-navigation';
import { getCurrentPlatform, type Platform } from '../../lib/platform-utils';
import { AIChatDrawer } from '../chat/ai-chat';
import { CustomSearchDialog } from '../layout/custom-search-dialog';
import {
  SearchInputToggle
} from '../layout/custom-search-toggle';
import {
  LanguageToggle,
  LanguageToggleText,
} from '../layout/language-toggle';
import { RootToggle } from '../layout/root-toggle';
import { ThemeToggle } from '../layout/theme-toggle';
import { buttonVariants } from '../ui/button';
import { HideIfEmpty } from '../ui/hide-if-empty';
import { ScrollArea, ScrollViewport } from '../ui/scroll-area';
import {
  CollapsibleControl,
  Navbar,
  NavbarSidebarTrigger,
} from './docs-client';
import {
  getSidebarTabsFromOptions,
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
  external = false
}: {
  href: string,
  children: ReactNode,
  external?: boolean,
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

// Function to find platform-specific content in the page tree
function findPlatformContent(tree: PageTree.Root, platform: string): PageTree.Node[] {
  // Platform folder name mappings
  const platformMappings: Record<string, string[]> = {
    'next': ['next.js', 'nextjs'],
    'react': ['react'],
    'js': ['javascript'],
    'python': ['python']
  };

  const platformKey = platform.toLowerCase();
  const possibleNames = platformKey in platformMappings ? platformMappings[platformKey] : [platformKey];

  for (const item of tree.children) {
    if (item.type === 'folder') {
      const itemName = String(item.name).toLowerCase();

      if (possibleNames.some(name => {
        const normalizedName = name.trim().toLowerCase();
        return itemName === normalizedName || itemName.includes(normalizedName);
      })) {
        return item.children;
      }
    }
  }

  return [];
}

// Recursive component to render page tree items with API styling
function PageTreeItem({ item, currentPlatform }: { item: PageTree.Node, currentPlatform?: string }) {
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
            <PageTreeItem key={child.type === 'page' ? child.url : index} item={child} currentPlatform={currentPlatform} />
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
          <PageTreeItem key={child.type === 'page' ? child.url : index} item={child} currentPlatform={currentPlatform} />
        ))}
      </CollapsibleSection>
    );
  }

  return (
    <DocsSidebarLink href={item.url} external={item.external}>
      {item.name}
    </DocsSidebarLink>
  );
}

// Function to render sidebar content based on context
function renderSidebarContent(tree: PageTree.Root, pathname: string) {
  const currentPlatform = getCurrentPlatform(pathname) || undefined;

  // For API section, don't show anything (API has its own sidebar)
  if (isInApiSection(pathname)) {
    return null;
  }

  // For platform-specific docs, show the platform folder's content
  if (currentPlatform) {
    const platformContent = findPlatformContent(tree, currentPlatform);
    if (platformContent.length > 0) {
      return (
        <>
          {platformContent.map((item, index) => (
            <PageTreeItem key={item.type === 'page' ? item.url : index} item={item} currentPlatform={currentPlatform} />
          ))}
        </>
      );
    }
  }

  // For general docs or when no platform content found, show root level content
  return (
    <>
      {tree.children.map((item, index) => (
        <PageTreeItem key={item.type === 'page' ? item.url : index} item={item} currentPlatform={currentPlatform} />
      ))}
    </>
  );
}

// Function to get platform icon and color (now matches the open sidebar colors)
function getPlatformIcon(platform: string): { icon: string, color: string } {
  const platformInfo: Record<string, { icon: string, color: string }> = {
    'next': { icon: 'N', color: 'rgb(59, 130, 246)' }, // Blue - matches homepage/sidebar
    'react': { icon: 'R', color: 'rgb(16, 185, 129)' }, // Green - matches homepage/sidebar
    'js': { icon: 'J', color: 'rgb(245, 158, 11)' }, // Yellow - matches homepage/sidebar
    'python': { icon: 'P', color: 'rgb(168, 85, 247)' } // Purple - matches homepage/sidebar
  };
  return platform in platformInfo ? platformInfo[platform] : { icon: '?', color: 'rgb(100, 116, 139)' };
}

// Get platform display name
function getPlatformDisplayName(platform: string): string {
  const platformNames: Record<string, string> = {
    'next': 'Next.js',
    'react': 'React',
    'js': 'JavaScript',
    'python': 'Python'
  };
  return platform in platformNames ? platformNames[platform] : platform;
}

// Collapsed Platform Switcher Component
function CollapsedPlatformSwitcher({ currentPlatform }: { currentPlatform?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredPlatform, setHoveredPlatform] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { setPreferredPlatform } = usePlatformPreference();

  // Update button position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      setButtonRect(buttonRef.current.getBoundingClientRect());
    }
  }, [isOpen]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHoveredPlatform(null);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (!currentPlatform) return null;

  const { icon, color } = getPlatformIcon(currentPlatform);
  const platforms = ['next', 'react', 'js', 'python'];

  const handlePlatformChange = (platform: string) => {
    setPreferredPlatform(platform as Platform);
    setIsOpen(false);
    setHoveredPlatform(null);

    // Use smart navigation like the open sidebar
    const smartUrl = getSmartRedirectUrl(pathname, platform as Platform);
    router.push(smartUrl);
  };

  const dropdownContent = isOpen && buttonRect ? (
    <div
      ref={dropdownRef}
      className="fixed bg-fd-background/95 backdrop-blur-lg border-2 border-fd-border rounded-lg shadow-2xl min-w-[140px] overflow-hidden"
      style={{
        left: buttonRect.right + 8,
        top: buttonRect.top,
        zIndex: 9999,
      }}
    >
      {platforms.map((platform) => {
        const isSelected = currentPlatform === platform;
        const isHovered = hoveredPlatform === platform;
        const isHighlighted = isSelected || isHovered;
        const { icon: platformIcon, color: platformColor } = getPlatformIcon(platform);

        return (
          <button
            key={platform}
            onClick={() => handlePlatformChange(platform)}
            onMouseEnter={() => setHoveredPlatform(platform)}
            onMouseLeave={() => setHoveredPlatform(null)}
            className={cn(
              'w-full px-3 py-2 text-left transition-all duration-200 border-l-4 border-transparent flex items-center gap-2',
              isHighlighted ? 'bg-fd-muted/70' : 'hover:bg-fd-muted/30',
            )}
            style={{
              borderLeftColor: isHighlighted ? platformColor : 'transparent',
              backgroundColor: isHighlighted ? `${platformColor}15` : undefined,
            }}
          >
            <span
              className="text-sm font-bold w-4 flex-shrink-0"
              style={{ color: platformColor }}
            >
              {platformIcon}
            </span>
            <span
              className="text-xs font-medium"
              style={{
                color: isHighlighted ? platformColor : undefined,
              }}
            >
              {getPlatformDisplayName(platform)}
            </span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="group relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center justify-center w-8 h-8 rounded-lg border transition-all duration-200",
          "hover:scale-110 hover:border-fd-primary/50 hover:bg-fd-primary/5",
          isOpen && "scale-110 border-fd-primary/50 bg-fd-primary/5"
        )}
        style={{
          color: color,
          borderColor: isOpen ? color : undefined,
          backgroundColor: isOpen ? `${color}15` : undefined
        }}
        title={`Platform: ${getPlatformDisplayName(currentPlatform)}`}
      >
        <span className="text-sm font-bold">{icon}</span>
      </button>

      {/* Render dropdown as portal to avoid clipping */}
      {typeof window !== 'undefined' && dropdownContent && createPortal(dropdownContent, document.body)}

      {/* Tooltip - only show when not open */}
      {!isOpen && (
        <div className="absolute left-full ml-2 px-2 py-1 bg-fd-popover text-fd-popover-foreground text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
          {getPlatformDisplayName(currentPlatform)} Docs
        </div>
      )}
    </div>
  );
}

// Enhanced page dot tooltips
function CollapsedPageDot({
  href,
  title,
  currentPlatform
}: {
  href: string,
  title: string,
  currentPlatform?: string,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [dotRect, setDotRect] = useState<DOMRect | null>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Determine if this page is currently active based on current pathname
  const isCurrentlyActive = pathname === href;

  // Get platform color, fallback to muted if no platform
  const platformColor = currentPlatform ? getPlatformIcon(currentPlatform).color : 'rgb(100, 116, 139)';

  // Update dot position when hovered
  useEffect(() => {
    if (isHovered && dotRef.current) {
      setDotRect(dotRef.current.getBoundingClientRect());
    }
  }, [isHovered]);

  const handleClick = () => {
    // Use smart navigation with fallback logic for page dots too
    try {
      router.push(href);
    } catch (error) {
      // If that fails, use smart platform redirect
      const currentPlatform = getCurrentPlatform(href);
      if (currentPlatform) {
        const fallbackUrl = getSmartPlatformRedirect(href, currentPlatform as Platform);
        router.push(fallbackUrl);
      }
    }
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
            opacity: isCurrentlyActive ? 1 : 0.6
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
  currentPlatform,
  defaultOpen = false
}: {
  title: string,
  href?: string,
  level?: number,
  items?: CollapsedItem[],
  currentPlatform?: string,
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

  const platformColor = currentPlatform ? getPlatformIcon(currentPlatform).color : 'rgb(100, 116, 139)';

  useEffect(() => {
    if (isHovered && dotRef.current) {
      setDotRect(dotRef.current.getBoundingClientRect());
    }
  }, [isHovered]);

  const handleNavigation = () => {
    // Expand the section when navigating to it
    setIsOpen(true);

    // Use smart navigation with fallback logic
    if (href) {
      try {
        // Try the direct href first
        router.push(href);
      } catch (error) {
        // If that fails, use smart platform redirect
        const currentPlatform = getCurrentPlatform(href);
        if (currentPlatform) {
          const fallbackUrl = getSmartPlatformRedirect(href, currentPlatform as Platform);
          router.push(fallbackUrl);
        }
      }
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
          currentPlatform={currentPlatform}
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
  currentPlatform,
  sectionItems = []
}: {
  title: string,
  level?: number,
  currentPlatform?: string,
  sectionItems?: string[],
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [dotRect, setDotRect] = useState<DOMRect | null>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  const platformColor = currentPlatform ? getPlatformIcon(currentPlatform).color : 'rgb(100, 116, 139)';

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
  currentPlatform,
  nextItems = []
}: {
  item: CollapsedItem,
  currentPlatform?: string,
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
        currentPlatform={currentPlatform}
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
        currentPlatform={currentPlatform}
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
        currentPlatform={currentPlatform}
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
  const currentPlatform = getCurrentPlatform(pathname) || undefined;

  if (!currentPlatform) return null;

  let hierarchicalItems: CollapsedItem[] = [];

  // For platform-specific content, use the platform folder
  const platformContent = findPlatformContent(tree, currentPlatform);
  if (platformContent.length > 0) {
    hierarchicalItems = convertToHierarchicalStructure(platformContent, pathname);
  } else {
    // Fallback to root tree if no platform-specific content found
    hierarchicalItems = convertToHierarchicalStructure(tree.children, pathname);
  }

  return (
    <div className="flex flex-col items-start space-y-2 py-4 w-full">
      {/* Platform switcher at the top */}
      <div className="flex justify-center w-full">
        <CollapsedPlatformSwitcher currentPlatform={currentPlatform} />
      </div>

      {/* Separator */}
      {currentPlatform && (
        <div className="flex justify-center w-full">
          <div className="w-4 h-px bg-fd-border" />
        </div>
      )}

      {/* Hierarchical navigation */}
      <div className="flex flex-col space-y-1 w-full">
        {hierarchicalItems.map((item, index) => (
          <CollapsedHierarchicalItem
            key={item.href || `${item.title}-${index}`}
            item={item}
            currentPlatform={currentPlatform}
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

  const tabs = useMemo(
    () => getSidebarTabsFromOptions(sidebar.tabs, props.tree) ?? [],
    [sidebar.tabs, props.tree],
  );
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
  };

  return (
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
              'flex flex-1 flex-row md:ml-64 pt-14 min-w-0',
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
                banner={
                  <>
                    {tabs.length > 0 ? <RootToggle options={tabs} /> : null}
                    {sidebar.banner}
                  </>
                }
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
            </div>
          </main>
          <AIChatDrawer />
        </NavProvider>
      </TreeContextProvider>
    </AccordionProvider>
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
        "hidden md:block fixed left-0 top-14 border-r border-fd-border bg-fd-background z-30 transition-all duration-300 ease-out",
        isMainSidebarCollapsed ? "w-16" : "w-64"
      )}>
        <div className="h-[calc(100vh-3.5rem)] flex flex-col">
          {/* Scrollable content area */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <ScrollArea className="h-full">
              <ScrollViewport className={isMainSidebarCollapsed ? "p-2" : "p-4"}>
                {!isMainSidebarCollapsed && (
                  <Link
                    href="/"
                    className="flex items-center gap-2 px-2 py-1.5 mb-2 text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Back to home
                  </Link>
                )}

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

          {/* Footer - with collapse button */}
          <div className="border-t border-fd-border p-4 flex-shrink-0">
            {isMainSidebarCollapsed ? (
              <div className="flex flex-col items-center gap-2">
                <DocsSidebarCollapseTrigger />
                <ThemeToggle mode="light-dark" />
              </div>
            ) : (
              <div className="space-y-2">
                <DocsSidebarCollapseTrigger />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-fd-muted-foreground">Stack Auth Docs</span>
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

export { getSidebarTabsFromOptions } from './docs/shared';
export { CollapsibleControl, Navbar, NavbarSidebarTrigger, type LinkItemType };

