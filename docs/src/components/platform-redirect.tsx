'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { usePlatformPreference } from '../hooks/use-platform-preference';
import { getSmartPlatformRedirect } from '../lib/platform-navigation';
import { getCurrentPlatform } from '../lib/platform-utils';

type PlatformRedirectProps = {
  /**
   * The current pathname to check if platform is missing
   */
  pathname: string,
  /**
   * Default path to redirect to after adding platform (e.g., 'overview', 'getting-started')
   */
  defaultPath?: string,
  /**
   * Whether to show loading state during redirect
   */
  showLoading?: boolean,
};

/**
 * Component that redirects users to their preferred platform when they visit
 * docs without a specific platform in the URL
 */
export function PlatformRedirect({
  pathname,
  defaultPath = 'overview',
  showLoading = true
}: PlatformRedirectProps) {
  const router = useRouter();
  const { preferredPlatform, isLoaded } = usePlatformPreference();

  useEffect(() => {
    // Only redirect if preferences are loaded and we're not already on a platform-specific page
    if (isLoaded) {
      const currentPlatform = getCurrentPlatform(pathname);

      // If we're on /docs or /docs/ without a platform, redirect to preferred platform
      if (pathname === '/docs' || pathname === '/docs/') {
        const redirectUrl = `/docs/${preferredPlatform}/${defaultPath}`;
        router.replace(redirectUrl);
        return;
      }

      // If we're on a docs page but no platform detected, use smart navigation
      if (pathname.startsWith('/docs/') && !currentPlatform) {
        const redirectUrl = getSmartPlatformRedirect(pathname, preferredPlatform);
        router.replace(redirectUrl);
        return;
      }
    }
  }, [isLoaded, pathname, preferredPlatform, defaultPath, router]);

  // Show loading state while redirecting
  if (showLoading && !isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-fd-primary mx-auto mb-4"></div>
          <p className="text-sm text-fd-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return null;
}

/**
 * Hook version of platform redirect for use in components
 */
export function usePlatformRedirect(pathname: string, defaultPath = 'overview') {
  const router = useRouter();
  const { preferredPlatform, isLoaded } = usePlatformPreference();

  useEffect(() => {
    if (isLoaded) {
      const currentPlatform = getCurrentPlatform(pathname);

      if (pathname === '/docs' || pathname === '/docs/') {
        const redirectUrl = `/docs/${preferredPlatform}/${defaultPath}`;
        router.replace(redirectUrl);
        return;
      }

      if (pathname.startsWith('/docs/') && !currentPlatform) {
        const redirectUrl = getSmartPlatformRedirect(pathname, preferredPlatform);
        router.replace(redirectUrl);
        return;
      }
    }
  }, [isLoaded, pathname, preferredPlatform, defaultPath, router]);

  return { isLoaded };
}
