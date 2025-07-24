'use client';
import type { PageTree } from 'fumadocs-core/server';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { usePathname } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import { getCurrentPlatform } from '../../lib/platform-utils';
import { ApiSidebarContent } from './api/api-sidebar';
import { PlatformAwareHeader } from './platform-aware-header';
import { isInApiSection } from './shared-header';

// Types for the page data
type PageData = {
  url: string,
  slugs: string[],
  data: {
    title?: string,
    method?: string,
  },
};

type DocsHeaderWrapperProps = {
  showSearch?: boolean,
  pageTree?: PageTree.Root,
  className?: string,
  apiPages?: PageData[],
}

// Custom Link Component for mobile sidebar - matches the styling from docs.tsx
function MobileSidebarLink({
  href,
  children,
  external = false
}: {
  href: string,
  children: React.ReactNode,
  external?: boolean,
}) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <a
      href={href}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
        isActive
          ? 'bg-fd-primary/10 text-fd-primary font-medium'
          : 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50'
      }`}
      {...(external && { target: '_blank', rel: 'noopener noreferrer' })}
    >
      <span className="flex-1">{children}</span>
    </a>
  );
}

// Custom separator component - matches the styling from docs.tsx
function MobileSidebarSeparator({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 mb-3 first:mt-2">
      <span className="text-xs font-bold text-fd-foreground uppercase tracking-wider">
        {children}
      </span>
    </div>
  );
}

// Custom collapsible section component - matches the styling from docs.tsx
function MobileCollapsibleSection({
  title,
  children,
  defaultOpen = false
}: {
  title: string,
  children: React.ReactNode,
  defaultOpen?: boolean,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Keep accordion open based on defaultOpen changes (for path-based logic)
  React.useEffect(() => {
    setIsOpen(defaultOpen);
  }, [defaultOpen]);

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

// Clickable collapsible section component for mobile - for folders with index pages
function MobileClickableCollapsibleSection({
  title,
  href,
  children,
  defaultOpen = false
}: {
  title: string,
  href: string,
  children: React.ReactNode,
  defaultOpen?: boolean,
}) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + '/');
  const shouldBeOpen = defaultOpen || isActive;
  const [isOpen, setIsOpen] = useState(shouldBeOpen);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Update accordion state when path changes to stay open for current section
  React.useEffect(() => {
    setIsOpen(shouldBeOpen);
  }, [shouldBeOpen]);

  // Close when clicking outside
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="space-y-1" ref={containerRef}>
      <div className="group">
        <a
          href={href}
          className={`flex items-center justify-between w-full px-2 py-1.5 rounded-md text-xs transition-colors ${
            isActive
              ? 'bg-fd-primary/10 text-fd-primary font-medium'
              : 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50'
          }`}
          onClick={() => setIsOpen(true)}
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
        </a>
      </div>
      {isOpen && (
        <div className="ml-4 space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}

// Recursive component to render page tree items for mobile
function MobilePageTreeItem({ item, currentPlatform }: { item: PageTree.Node, currentPlatform?: string }) {
  const pathname = usePathname();

  if (item.type === 'separator') {
    return <MobileSidebarSeparator>{item.name}</MobileSidebarSeparator>;
  }

  if (item.type === 'folder') {
    const hasIndexPage = 'index' in item && item.index;
    const folderUrl = hasIndexPage ? item.index!.url : '';
    const isCurrentPath = folderUrl && pathname.startsWith(folderUrl);
    const itemName = String(item.name);

    // If folder has an index page, make the title clickable
    if (hasIndexPage) {
      return (
        <MobileClickableCollapsibleSection
          title={itemName || 'Folder'}
          href={item.index!.url}
          defaultOpen={!!isCurrentPath}
        >
          {item.children.map((child, index) => (
            <MobilePageTreeItem key={child.type === 'page' ? child.url : index} item={child} currentPlatform={currentPlatform} />
          ))}
        </MobileClickableCollapsibleSection>
      );
    }

    // If no index page, use regular accordion trigger
    return (
      <MobileCollapsibleSection
        title={itemName || 'Folder'}
        defaultOpen={!!isCurrentPath}
      >
        {item.children.map((child, index) => (
          <MobilePageTreeItem key={child.type === 'page' ? child.url : index} item={child} currentPlatform={currentPlatform} />
        ))}
      </MobileCollapsibleSection>
    );
  }

  return (
    <MobileSidebarLink href={item.url} external={item.external}>
      {item.name}
    </MobileSidebarLink>
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

      for (const name of possibleNames) {
        if (itemName.includes(name)) {
          return item.children;
        }
      }
    }
  }

  return [];
}

// Improved general docs sidebar content that renders the platform content
function GeneralDocsSidebarContent({ pageTree, pathname }: { pageTree?: PageTree.Root, pathname: string }) {
  const currentPlatform = getCurrentPlatform(pathname);

  if (!currentPlatform || !pageTree) return null;

  // For platform-specific docs, show the platform folder's content
  const platformContent = findPlatformContent(pageTree, currentPlatform);
  if (platformContent.length > 0) {
    return (
      <>
        {platformContent.map((item, index) => (
          <MobilePageTreeItem key={item.type === 'page' ? item.url : index} item={item} currentPlatform={currentPlatform} />
        ))}
      </>
    );
  }

  // For general docs or when no platform content found, show root level content
  return (
    <>
      {pageTree.children.map((item, index) => (
        <MobilePageTreeItem key={item.type === 'page' ? item.url : index} item={item} currentPlatform={currentPlatform} />
      ))}
    </>
  );
}

/**
 * CLIENT-SIDE HEADER WRAPPER
 *
 * This component wraps the PlatformAwareHeader and dynamically provides
 * sidebar content based on the current route. It's a client component
 * that can use hooks to determine the current section and provide
 * appropriate sidebar content for mobile navigation.
 */
export function DocsHeaderWrapper({ showSearch = true, pageTree, className, apiPages }: DocsHeaderWrapperProps) {
  const pathname = usePathname();

  // Determine current sidebar content based on route
  const sidebarContent = useMemo(() => {
    if (isInApiSection(pathname)) {
      return <ApiSidebarContent pages={apiPages} />;
    }

    // For all docs pages, use the page tree
    if (pathname.startsWith('/docs') && !isInApiSection(pathname)) {
      return <GeneralDocsSidebarContent pageTree={pageTree} pathname={pathname} />;
    }

    return null;
  }, [pathname, pageTree, apiPages]);

  return (
    <PlatformAwareHeader
      showSearch={showSearch}
      sidebarContent={sidebarContent}
      className={className}
    />
  );
}
