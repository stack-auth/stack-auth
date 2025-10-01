/**
 * DOCS LAYOUT ROUTER
 *
 * This file contains the routing logic that determines which layout configuration
 * to use based on the current URL path. It acts as a smart wrapper around the
 * base DocsLayout component.
 *
 * ARCHITECTURE:
 * 1. app/docs/layout.tsx
 *    ↓ imports DynamicDocsLayout
 * 2. docs-layout-router.tsx (THIS FILE)
 *    ↓ routes to appropriate config → imports DocsLayout
 * 3. docs.tsx (BASE LAYOUT)
 *    ↓ renders the actual layout structure
 *
 * RESPONSIBILITIES:
 * - Route detection (SDK, Components, API, etc.)
 * - Passing appropriate props to base DocsLayout
 * - Filter page tree for SDK/Components sections
 *
 * SECTION HANDLING:
 * SDK and Components sections are included in the main page tree but are
 * filtered to show only the relevant section when browsing those areas.
 */

'use client';
import { baseOptions } from '@/app/layout.config';
import { filterTreeForSection, resolveDocsSection } from '@/lib/docs-tree';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { ApiSidebarContent } from './api/api-sidebar';
import { DocsLayout, type DocsLayoutProps } from './docs';
import { isInApiSection, isInCustomizationSection } from './shared/section-utils';

type DynamicDocsLayoutProps = {
  children: ReactNode,
} & Omit<DocsLayoutProps, 'links'>

export function DynamicDocsLayout({ children, ...props }: DynamicDocsLayoutProps) {
  const pathname = usePathname();
  const section = resolveDocsSection(pathname);
  const sectionTree = useMemo(() => filterTreeForSection(props.tree, section), [props.tree, section]);

  // For API docs, use minimal layout without platform tabs
  if (isInApiSection(pathname)) {
    return (
      <DocsLayout
        {...baseOptions}
        {...props}
        tree={props.tree}
        nav={{
          enabled: false, // Disable Fumadocs navbar - using SharedHeader instead
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
          // Hide the page tree when showing custom API content
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

  // For customization section, use normal page tree without platform tabs
  if (isInCustomizationSection(pathname)) {
    return (
      <DocsLayout
        {...baseOptions}
        {...props}
        tree={sectionTree}
        nav={{
          enabled: false, // Disable Fumadocs navbar - using SharedHeader instead - Much cleaner look, dont like dropdown.
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

  // For all other sections, use the standard layout without platform tabs
  return (
    <DocsLayout
      {...baseOptions}
      {...props}
      tree={sectionTree}
      nav={{
        enabled: false, // Disable Fumadocs navbar - using SharedHeader instead
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
