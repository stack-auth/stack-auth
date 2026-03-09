'use client';
import { docsConfig, findActiveSection, type SidebarCategory, type SidebarSection } from '@/docs-config';
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

function MobileConfigCategory({ category }: { category: SidebarCategory }) {
  return (
    <>
      {category.title != null && (
        <MobileSidebarSeparator>{category.title}</MobileSidebarSeparator>
      )}
      {category.pages.map((page) => (
        <MobileSidebarLink key={page.href} href={page.href}>
          {page.title}
        </MobileSidebarLink>
      ))}
    </>
  );
}

function MobileSidebarSection({ section, isOpen, onToggle }: {
  section: SidebarSection,
  isOpen: boolean,
  onToggle: () => void,
}) {
  return (
    <div className="space-y-1">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm font-semibold text-fd-foreground hover:text-fd-foreground/80 transition-colors"
      >
        <span>{isOpen ? '▾' : '▸'}</span>
        {section.title}
      </button>
      {isOpen && (
        <div className="ml-4 space-y-1">
          {section.categories.map((category, index) => (
            <MobileConfigCategory key={category.title ?? `untitled-${index}`} category={category} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigMobileSidebarContent({ pathname }: { pathname: string }) {
  const activeSection = findActiveSection(pathname);
  const [openSections, setOpenSections] = React.useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const section of docsConfig.sections) {
      initial[section.title] = section.defaultOpen || activeSection?.title === section.title;
    }
    return initial;
  });

  return (
    <>
      {/* Sections */}
      {docsConfig.sections.map((section) => (
        <MobileSidebarSection
          key={section.title}
          section={section}
          isOpen={openSections[section.title] ?? false}
          onToggle={() => setOpenSections(prev => ({
            ...prev,
            [section.title]: !prev[section.title],
          }))}
        />
      ))}
    </>
  );
}

export function DocsHeaderWrapper({ showSearch = true, apiPages }: DocsHeaderWrapperProps) {
  const pathname = usePathname();

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
      showSearch={showSearch}
      sidebarContent={sidebarContent}
    />
  );
}
