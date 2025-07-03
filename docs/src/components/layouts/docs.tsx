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
  type PageStyles,
  StylesProvider,
} from 'fumadocs-ui/contexts/layout';
import { TreeContextProvider } from 'fumadocs-ui/contexts/tree';
import { ArrowLeft, ChevronDown, ChevronRight, Languages } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { createContext, type HTMLAttributes, type ReactNode, useContext, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { getCurrentPlatform } from '../../lib/platform-utils';
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
import { ComponentsSidebarContent } from './docs-layout-router';
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
import { type BaseLayoutProps, getLinks, omit, slot, slots } from './shared';
import {
  isInApiSection,
  isInComponentsSection,
  isInSdkSection
} from './shared/section-utils';

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
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-fd-muted/30"
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

// SDK-specific sidebar content
export function SdkSidebarContent() {
  const pathname = usePathname();
  const currentPlatform = getCurrentPlatform(pathname) || undefined;

  if (!currentPlatform) return null;

  const baseUrl = `/docs/${currentPlatform}/sdk`;
  const isReactLike = ['next', 'react'].includes(currentPlatform);

  return (
    <>
      <DocsSidebarLink href={`${baseUrl}/overview`}>
        Overview
      </DocsSidebarLink>

      <DocsSeparator>
        Objects
      </DocsSeparator>
      <DocsSidebarLink href={`${baseUrl}/objects/stack-app`}>
        StackApp
      </DocsSidebarLink>

      <DocsSeparator>
        Types
      </DocsSeparator>
      <DocsSidebarLink href={`${baseUrl}/types/user`}>
        User
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/types/team`}>
        Team
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/types/team-user`}>
        TeamUser
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/types/team-permission`}>
        TeamPermission
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/types/team-profile`}>
        TeamProfile
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/types/contact-channel`}>
        ContactChannel
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/types/api-key`}>
        API Key
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/types/project`}>
        Project
      </DocsSidebarLink>

      {isReactLike && (
        <>
          <DocsSeparator>
            Hooks
          </DocsSeparator>
          <DocsSidebarLink href={`${baseUrl}/hooks/use-stack-app`}>
            useStackApp()
          </DocsSidebarLink>
          <DocsSidebarLink href={`${baseUrl}/hooks/use-user`}>
            useUser()
          </DocsSidebarLink>
        </>
      )}
    </>
  );
}

// Function to find platform-specific content in the page tree
function findPlatformContent(tree: PageTree.Root, platform: string): PageTree.Node[] {
  const platformMappings: Record<string, string[]> = {
    'next': ['next', 'next.js', 'nextjs'],
    'react': ['react', 'react.js', 'reactjs'],
    'js': ['js', 'javascript'],
    'python': ['python', 'py']
  };

  const possibleNames = platformMappings[platform.toLowerCase()] ?? [platform.toLowerCase()];

  for (const item of tree.children) {
    if (item.type === 'folder') {
      const itemName = typeof item.name === 'string' ? item.name.toLowerCase() : '';

      if (possibleNames.some(name => itemName === name || itemName.includes(name))) {
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

  // For SDK section, show SDK-specific content
  if (isInSdkSection(pathname)) {
    return <SdkSidebarContent />;
  }

  // For Components section, show Components-specific content
  if (isInComponentsSection(pathname)) {
    return <ComponentsSidebarContent />;
  }

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

  // For general docs, show root level content
  return (
    <>
      {tree.children.map((item, index) => (
        <PageTreeItem key={item.type === 'page' ? item.url : index} item={item} currentPlatform={currentPlatform} />
      ))}
    </>
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

  return (
    <>
      {collapsible ? <CollapsibleControl onSearchOpen={onSearchOpen} /> : null}
      {/* Sidebar positioned under the header */}
      <div className="hidden md:block fixed left-0 top-14 w-64 border-r border-fd-border bg-fd-background z-30">
        <div className="h-[calc(100vh-3.5rem)] flex flex-col">
          {/* Scrollable content area - no header needed since branding is in main header */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <ScrollArea className="h-full">
              <ScrollViewport className="p-4">
                <Link
                  href="/"
                  className="flex items-center gap-2 px-2 py-1.5 mb-2 text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to home
                </Link>

                {/* Platform tabs/banner */}
                {banner && (
                  <div className="mb-4">
                    {banner}
                  </div>
                )}

                {/* Page tree content */}
                <div className="space-y-1">
                  {renderSidebarContent(props.tree || { name: 'root', children: [] } as PageTree.Root, pathname)}
                </div>
              </ScrollViewport>
            </ScrollArea>
          </div>

          {/* Footer - matches API layout */}
          <div className="border-t border-fd-border p-4 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs text-fd-muted-foreground">Stack Auth Docs</span>
              <ThemeToggle mode="light-dark" />
            </div>
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

