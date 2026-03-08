'use client';
import { generateNavLinks } from '@/lib/navigation-utils';
import { findActiveTab, type PageItem, type SidebarCategory } from '@/docs-config';
import type { PageTree } from 'fumadocs-core/server';
import { usePathname } from 'next/navigation';
import React, { useMemo } from 'react';
import { ApiSidebarContent } from './api/api-sidebar';
import { SharedHeader, isInApiSection } from './shared-header';

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
  apiPages?: PageData[],
}

function MobileSidebarLink({
  href,
  children,
}: {
  href: string,
  children: React.ReactNode,
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
    >
      <span className="flex-1">{children}</span>
    </a>
  );
}

function MobileSidebarSeparator({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 mb-3 first:mt-2">
      <span className="text-xs font-bold text-fd-foreground uppercase tracking-wider">
        {children}
      </span>
    </div>
  );
}

function MobilePageItem({ page, depth = 0 }: { page: PageItem, depth?: number }) {
  if (page.children && page.children.length > 0) {
    return (
      <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
        <MobileSidebarLink href={page.href}>
          {page.title}
        </MobileSidebarLink>
        <div className="ml-3 border-l border-fd-border/50 pl-1">
          {page.children.map((child) => (
            <MobilePageItem key={child.href} page={child} depth={depth + 1} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      <MobileSidebarLink href={page.href}>
        {page.title}
      </MobileSidebarLink>
    </div>
  );
}

function MobileConfigCategory({ category }: { category: SidebarCategory }) {
  return (
    <>
      {category.title != null && (
        <MobileSidebarSeparator>{category.title}</MobileSidebarSeparator>
      )}
      {category.pages.map((page) => (
        <MobilePageItem key={page.href} page={page} />
      ))}
    </>
  );
}

function ConfigMobileSidebarContent({ pathname }: { pathname: string }) {
  const activeTab = findActiveTab(pathname);
  if (!activeTab) return null;

  return (
    <>
      {activeTab.sidebarCategories.map((category, index) => (
        <MobileConfigCategory key={category.title ?? `untitled-${index}`} category={category} />
      ))}
    </>
  );
}

export function DocsHeaderWrapper({ showSearch = true, apiPages }: DocsHeaderWrapperProps) {
  const pathname = usePathname();
  const navLinks = useMemo(() => generateNavLinks(), []);

  const sidebarContent = useMemo(() => {
    if (isInApiSection(pathname)) {
      return <ApiSidebarContent pages={apiPages} />;
    }

    if (pathname.startsWith('/docs')) {
      return <ConfigMobileSidebarContent pathname={pathname} />;
    }

    return null;
  }, [pathname, apiPages]);

  return (
    <SharedHeader
      navLinks={navLinks}
      showSearch={showSearch}
      sidebarContent={sidebarContent}
    />
  );
}
