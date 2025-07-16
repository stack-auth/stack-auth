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
 * - Platform tab configuration
 * - Passing appropriate props to base DocsLayout
 * - Filter page tree for SDK/Components sections
 *
 * SECTION HANDLING:
 * SDK and Components sections are included in the main page tree but are
 * filtered to show only the relevant section when browsing those areas.
 */

'use client';
import { baseOptions } from '@/app/layout.config';
import type { PageTree } from 'fumadocs-core/server';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { getSmartRedirectUrl } from '../../lib/navigation-utils';
import { getCurrentPlatform, PLATFORMS } from '../../lib/platform-utils';
import type { Option } from '../layout/root-toggle';
import { PlatformRedirect } from '../platform-redirect';
import { ApiSidebarContent } from './api/api-sidebar';
import { DocsLayout, type DocsLayoutProps } from './docs';
import {
  getPlatformDisplayName,
  isInApiSection,
  isInCustomizationSection
} from './shared/section-utils';

type DynamicDocsLayoutProps = {
  children: ReactNode,
} & Omit<DocsLayoutProps, 'links'>

// Helper function to check if we're in SDK section
function isInSdkSection(pathname: string): boolean {
  // Match the actual SDK section: /docs/platform/sdk or /docs/platform/sdk/...
  // This excludes docs pages that might mention SDK in other contexts
  const match = pathname.match(/^\/docs\/[^\/]+\/sdk($|\/)/);
  return Boolean(match);
}

// Helper function to check if we're in Components section
function isInComponentsSection(pathname: string): boolean {
  // Match the actual Components section: /docs/platform/components or /docs/platform/components/...
  // This excludes docs pages like /docs/platform/getting-started/components
  const match = pathname.match(/^\/docs\/[^\/]+\/components($|\/)/);
  return Boolean(match);
}

// Helper function to find and extract a specific section from the page tree
function findSectionInTree(tree: PageTree.Root, sectionName: string, pathname: string): PageTree.Root | null {
  // Look for the section in the current platform's content
  const currentPlatform = getCurrentPlatform(pathname);
  if (!currentPlatform) return null;

  // Platform name mappings
  const platformMappings: Record<string, string> = {
    'next': 'Next.js',
    'react': 'React',
    'js': 'JavaScript',
    'python': 'Python'
  };

  const platformDisplayName = platformMappings[currentPlatform];
  if (!platformDisplayName) return null;

  // Find the platform folder
  const platformFolder = tree.children.find(node =>
    node.type === 'folder' && node.name === platformDisplayName
  );

  if (platformFolder && platformFolder.type === 'folder') {
    // Look for the section within the platform folder
    const sectionFolder = platformFolder.children.find(node =>
      node.type === 'folder' && node.name === sectionName
    );

    if (sectionFolder && sectionFolder.type === 'folder') {
      return {
        name: sectionFolder.name,
        children: sectionFolder.children,
        $id: tree.$id ? `${tree.$id}/${sectionName}` : sectionName,
      };
    }
  }

  return null;
}

export function DynamicDocsLayout({ children, ...props }: DynamicDocsLayoutProps) {
  const pathname = usePathname();

  // Determine which tree to use based on the current section
  const pageTree = useMemo(() => {
    if (isInSdkSection(pathname)) {
      const sdkTree = findSectionInTree(props.tree, 'SDK Reference', pathname);
      if (sdkTree) {
        //console.log('🎯 Using SDK tree for:', pathname);
        return sdkTree;
      }
    }

    if (isInComponentsSection(pathname)) {
      const componentsTree = findSectionInTree(props.tree, 'Components', pathname);
      if (componentsTree) {
        //console.log('🎯 Using Components tree for:', pathname);
        return componentsTree;
      }
    }

    // For normal docs view, filter out SDK and Components sections
    //console.log('📄 Using filtered page tree for:', pathname);
    return {
      ...props.tree,
      children: props.tree.children.map(platformNode => {
        if (platformNode.type === 'folder') {
          return {
            ...platformNode,
            children: platformNode.children.filter(node => {
              // Hide SDK Reference and Components sections from normal docs
              if (node.type === 'folder' && (node.name === 'SDK Reference' || node.name === 'Components')) {
                return false;
              }
              return true;
            })
          };
        }
        return platformNode;
      })
    };
  }, [pathname, props.tree]);

  const platformOptions: Option[] = useMemo(() => {
    // Extract current platform from pathname
    const currentPlatform = getCurrentPlatform(pathname);

    return PLATFORMS.map(platform => {
      let url: string;

      if (isInSdkSection(pathname)) {
        // For SDK section: /docs/platform/sdk
        url = `/docs/${platform}/sdk`;
      } else if (isInComponentsSection(pathname)) {
        // For Components section: /docs/platform/components
        url = `/docs/${platform}/components`;
      } else {
        // For normal docs: use smart redirect
        url = getSmartRedirectUrl(pathname, platform);
      }

      return {
        url,
        title: getPlatformDisplayName(platform),
        // Add urls set for more precise matching if this is the current platform
        ...(platform === currentPlatform && {
          urls: new Set([pathname])
        })
      };
    });
  }, [pathname]);

  // Auto-redirect to current platform if needed
  if (pathname === '/docs' || pathname === '/docs/') {
    return <PlatformRedirect pathname={pathname} defaultPath="overview" />;
  }

  // For API docs, use minimal layout without platform tabs
  if (isInApiSection(pathname)) {
    return (
      <DocsLayout
        {...baseOptions}
        {...props}
        tree={pageTree}
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
          tabs: [], // No platform tabs for shared API docs
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
        tree={pageTree}
        nav={{
          enabled: false, // Disable Fumadocs navbar - using SharedHeader instead
        }}
        links={[]}
        sidebar={{
          ...props.sidebar,
          tabs: [], // No platform tabs for customization section
        }}
      >
        {children}
      </DocsLayout>
    );
  }

  // For all other sections, use the standard layout with platform tabs
  // The pageTree will be filtered for SDK/Components sections automatically
  return (
    <DocsLayout
      {...baseOptions}
      {...props}
      tree={pageTree}
      nav={{
        enabled: false, // Disable Fumadocs navbar - using SharedHeader instead
      }}
      links={[]}
      sidebar={{
        ...props.sidebar,
        tabs: platformOptions,
      }}
    >
      {children}
    </DocsLayout>
  );
}
