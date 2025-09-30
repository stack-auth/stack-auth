'use client';
import type { PageTree } from 'fumadocs-core/server';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { usePathname } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import { generateNavLinks } from '@/lib/navigation-utils';
import { ApiSidebarContent } from './api/api-sidebar';
import { SharedHeader } from './shared-header';
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
function MobilePageTreeItem({ item }: { item: PageTree.Node }) {
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
            <MobilePageTreeItem key={child.type === 'page' ? child.url : index} item={child} />
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
          <MobilePageTreeItem key={child.type === 'page' ? child.url : index} item={child} />
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

function GeneralDocsSidebarContent({ pageTree }: { pageTree?: PageTree.Root }) {
  if (!pageTree) return null;

  return (
    <>
      {pageTree.children.map((item, index) => (
        <MobilePageTreeItem key={item.type === 'page' ? item.url : index} item={item} />
      ))}
    </>
  );
}

/**
 * CLIENT-SIDE HEADER WRAPPER
 *
 * This component wraps the shared header and dynamically provides
 * sidebar content based on the current route. It's a client component
 * that can use hooks to determine the current section and provide
 * appropriate sidebar content for mobile navigation.
 */
export function DocsHeaderWrapper({ showSearch = true, pageTree, className, apiPages }: DocsHeaderWrapperProps) {
  const pathname = usePathname();
  const navLinks = useMemo(() => generateNavLinks(), []);

  // Determine current sidebar content based on route
  const sidebarContent = useMemo(() => {
    if (isInApiSection(pathname)) {
      return <ApiSidebarContent pages={apiPages} />;
    }

    // For all docs pages, use the page tree
    if (pathname.startsWith('/docs') && !isInApiSection(pathname)) {
      return <GeneralDocsSidebarContent pageTree={pageTree} />;
    }

    return null;
  }, [pathname, pageTree, apiPages]);

  return (
    <SharedHeader
      navLinks={navLinks}
      showSearch={showSearch}
      sidebarContent={sidebarContent}
      className={className}
    />
  );
}
