'use client';
import type { PageTree } from 'fumadocs-core/server';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { getCurrentPlatform } from '../../lib/platform-utils';
import { ApiSidebarContent } from './api/api-sidebar';
import { SdkSidebarContent } from './docs';
import { ComponentsSidebarContent } from './docs-layout-router';
import { PlatformAwareHeader } from './platform-aware-header';
import {
  isInApiSection,
  isInComponentsSection,
  isInSdkSection
} from './shared/section-utils';

type DocsHeaderWrapperProps = {
  showSearch?: boolean,
  pageTree?: PageTree.Root,
  className?: string,
  apiPages?: Array<{
    url: string,
    slugs: string[],
    data: {
      title?: string,
      method?: string,
    },
  }>,
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
    const itemName = typeof item.name === 'string' ? item.name : '';

    return (
      <MobileCollapsibleSection
        title={itemName || 'Folder'}
        defaultOpen={!!isCurrentPath}
      >
        {hasIndexPage && (
          <MobileSidebarLink href={item.index!.url} external={item.index!.external}>
            Overview
          </MobileSidebarLink>
        )}
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
  const platformMappings = {
    'next': ['next', 'next.js', 'nextjs'],
    'react': ['react', 'react.js', 'reactjs'],
    'js': ['js', 'javascript'],
    'python': ['python', 'py']
  };

  const platformKey = platform.toLowerCase();
  const possibleNames = platformKey in platformMappings
    ? platformMappings[platformKey as keyof typeof platformMappings]
    : [platform.toLowerCase()];

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

// Improved general docs sidebar content that renders the full page tree
function GeneralDocsSidebarContent({ pageTree }: { pageTree?: PageTree.Root }) {
  const pathname = usePathname();
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

  // For general docs, show root level content
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
    if (isInSdkSection(pathname)) {
      const currentPlatform = getCurrentPlatform(pathname);
      if (currentPlatform && ['next', 'react', 'js'].includes(currentPlatform)) {
        return <SdkSidebarContent />;
      }
    }

    if (isInComponentsSection(pathname)) {
      const currentPlatform = getCurrentPlatform(pathname);
      if (currentPlatform && ['next', 'react'].includes(currentPlatform)) {
        return <ComponentsSidebarContent />;
      }
    }

    if (isInApiSection(pathname)) {
      return <ApiSidebarContent pages={apiPages} />;
    }

    // For general documentation pages
    if (pathname.startsWith('/docs') &&
        !isInComponentsSection(pathname) &&
        !isInSdkSection(pathname) &&
        !isInApiSection(pathname)) {
      return <GeneralDocsSidebarContent pageTree={pageTree} />;
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
