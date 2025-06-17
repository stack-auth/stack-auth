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
 * - Custom sidebar content selection
 * - Passing appropriate props to base DocsLayout
 *
 * CUSTOM SIDEBAR COMPONENTS:
 * - ComponentsSidebarContent: Full components navigation
 * - SdkSidebarContent: Imported from docs.tsx
 * - ApiSidebarContent: Imported from api/api-sidebar.tsx
 */

'use client';
import { baseOptions } from '@/app/layout.config';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { getCurrentPlatformUrl, getSmartRedirectUrl } from '../../lib/navigation-utils';
import { getCurrentPlatform, PLATFORMS } from '../../lib/platform-utils';
import type { Option } from '../layout/root-toggle';
import { ApiSidebarContent } from './api/api-sidebar';
import { DocsLayout, type DocsLayoutProps, SdkSidebarContent } from './docs';
import {
  getPlatformDisplayName,
  isInApiSection,
  isInComponentsSection,
  isInCustomizationSection,
  isInSdkSection
} from './shared/section-utils';

type DynamicDocsLayoutProps = {
  children: ReactNode,
} & Omit<DocsLayoutProps, 'links'>

// Custom Link Component for docs sidebar - matches the one in docs.tsx
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

// Custom separator component - matches the one in docs.tsx
function DocsSeparator({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 mb-3 first:mt-2">
      <span className="text-xs font-bold text-fd-foreground uppercase tracking-wider">
        {children}
      </span>
    </div>
  );
}

// Custom sidebar content for components section
export function ComponentsSidebarContent() {
  const pathname = usePathname();
  const currentPlatform = getCurrentPlatform(pathname);

  if (!currentPlatform) return null;

  const baseUrl = `/docs/${currentPlatform}/components`;

  return (
    <>
      <DocsSidebarLink href={`${baseUrl}/overview`}>
        Overview
      </DocsSidebarLink>

      <DocsSeparator>
        Authentication
      </DocsSeparator>
      <DocsSidebarLink href={`${baseUrl}/sign-in`}>
        Sign In
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/sign-up`}>
        Sign Up
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/credential-sign-in`}>
        Credential Sign In
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/credential-sign-up`}>
        Credential Sign Up
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/magic-link-sign-in`}>
        Magic Link Sign In
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/forgot-password`}>
        Forgot Password
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/password-reset`}>
        Password Reset
      </DocsSidebarLink>

      <DocsSeparator>
        OAuth
      </DocsSeparator>
      <DocsSidebarLink href={`${baseUrl}/oauth-button`}>
        OAuth Button
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/oauth-button-group`}>
        OAuth Button Group
      </DocsSidebarLink>

      <DocsSeparator>
        User Interface
      </DocsSeparator>
      <DocsSidebarLink href={`${baseUrl}/user-button`}>
        User Button
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/account-settings`}>
        Account Settings
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/selected-team-switcher`}>
        Selected Team Switcher
      </DocsSidebarLink>

      <DocsSeparator>
        Layout & Providers
      </DocsSeparator>
      <DocsSidebarLink href={`${baseUrl}/stack-provider`}>
        Stack Provider
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/stack-handler`}>
        Stack Handler
      </DocsSidebarLink>
      <DocsSidebarLink href={`${baseUrl}/stack-theme`}>
        Stack Theme
      </DocsSidebarLink>
    </>
  );
}

export function DynamicDocsLayout({ children, ...props }: DynamicDocsLayoutProps) {
  const pathname = usePathname();

  const platformOptions: Option[] = useMemo(() => {
    const currentPlatform = getCurrentPlatform(pathname);

    return PLATFORMS.map(platform => {
      const url = getSmartRedirectUrl(pathname, platform);
      const currentUrl = getCurrentPlatformUrl(pathname, platform);
      const isCurrentPlatform = currentPlatform === platform;

      // Check for specific sections using proper regex
      const componentsMatch = pathname.match(/^\/docs\/[^/]+\/components(\/.*)$/);
      const sdkMatch = pathname.match(/^\/docs\/[^/]+\/sdk(\/.*)$/);

      return {
        url,
        title: getPlatformDisplayName(platform),
        description: `Stack Auth ${getPlatformDisplayName(platform)}`,
        // Add URLs set to help with matching the current platform
        urls: new Set([
          url,
          currentUrl,
          `/docs/${platform}`,
          `/docs/${platform}/overview`,
          // Add specific section URLs for better matching
          ...(sdkMatch ? [`/docs/${platform}/sdk`] : []),
          ...(componentsMatch ? [`/docs/${platform}/components`] : []),
          // Add exact current path for the current platform
          ...(isCurrentPlatform ? [pathname] : []),
        ])
      };
    });
  }, [pathname]);

  // For API docs, use minimal layout without platform tabs
  if (isInApiSection(pathname)) {
    return (
      <DocsLayout
        {...baseOptions}
        {...props}
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

  // For SDK section, show SDK-specific sidebar
  if (isInSdkSection(pathname)) {
    // Only show SDK section for platforms that support it
    const currentPlatform = getCurrentPlatform(pathname);
    if (!currentPlatform || !['next', 'react', 'js'].includes(currentPlatform)) {
      // Redirect to overview if platform doesn't support SDK
      return (
        <DocsLayout
          {...baseOptions}
          {...props}
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

    return (
      <DocsLayout
        {...baseOptions}
        {...props}
        nav={{
          enabled: false, // Disable Fumadocs navbar - using SharedHeader instead
        }}
        links={[
          {
            type: 'custom',
            children: <SdkSidebarContent />
          }
        ]}
        sidebar={{
          ...props.sidebar,
          tabs: platformOptions,
          // Hide the page tree when showing custom SDK content
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

  // For Components section, show Components-specific sidebar
  if (isInComponentsSection(pathname)) {
    // Only show Components section for platforms that support React components
    const currentPlatform = getCurrentPlatform(pathname);
    if (!currentPlatform || !['next', 'react'].includes(currentPlatform)) {
      // Redirect to overview if platform doesn't support components
      return (
        <DocsLayout
          {...baseOptions}
          {...props}
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

    return (
      <DocsLayout
        {...baseOptions}
        {...props}
        nav={{
          enabled: false, // Disable Fumadocs navbar - using SharedHeader instead
        }}
        links={[
          {
            type: 'custom',
            children: <ComponentsSidebarContent />
          }
        ]}
        sidebar={{
          ...props.sidebar,
          tabs: platformOptions,
          // Hide the page tree when showing custom components content
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

  // Default: show normal platform docs with page tree navigation
  return (
    <DocsLayout
      {...baseOptions}
      {...props}
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
