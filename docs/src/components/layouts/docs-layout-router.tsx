'use client';
import { baseOptions } from '@/app/layout.config';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ApiSidebarContent } from './api/api-sidebar';
import { DocsLayout, type DocsLayoutProps } from './docs';
import { isInApiSection } from './shared/section-utils';

type DynamicDocsLayoutProps = {
  children: ReactNode,
} & Omit<DocsLayoutProps, 'links'>

export function DynamicDocsLayout({ children, ...props }: DynamicDocsLayoutProps) {
  const pathname = usePathname();

  if (isInApiSection(pathname)) {
    return (
      <DocsLayout
        {...baseOptions}
        {...props}
        tree={props.tree}
        nav={{
          enabled: false,
        }}
        links={[
          {
            type: 'custom',
            children: <ApiSidebarContent />
          }
        ]}
        sidebar={{
          ...props.sidebar,
          tabs: false,
          components: {
            Item: () => null,
            Folder: () => null,
            Separator: () => null,
          },
        }}
      >
        {children}
      </DocsLayout>
    );
  }

  return (
    <DocsLayout
      {...baseOptions}
      {...props}
      tree={props.tree}
      nav={{
        enabled: false,
      }}
      links={[]}
      sidebar={{
        ...props.sidebar,
        tabs: false,
      }}
    >
      {children}
    </DocsLayout>
  );
}
