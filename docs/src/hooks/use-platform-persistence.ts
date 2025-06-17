'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DEFAULT_PLATFORM, getCurrentPlatform, type Platform } from '../lib/platform-utils';

const STORAGE_KEY = 'stack-docs-platform';

/**
 * Hook that manages platform persistence across docs and API navigation.
 *
 * When user is on docs pages, it detects and stores the current platform.
 * When user is on API pages, it returns the stored platform or default.
 * This allows seamless navigation back to the correct platform.
 */
export function usePlatformPersistence(): Platform {
  const pathname = usePathname();
  const [storedPlatform, setStoredPlatform] = useState<Platform>(DEFAULT_PLATFORM);
  const [isClient, setIsClient] = useState(false);

  // Handle client-side hydration
  useEffect(() => {
    setIsClient(true);

    // Load stored platform from localStorage on client mount
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ['next', 'react', 'js', 'python'].includes(stored)) {
      setStoredPlatform(stored as Platform);
    }
  }, []);

  useEffect(() => {
    if (!isClient) return;

    // Get current platform from URL (if on docs pages)
    const currentPlatform = getCurrentPlatform(pathname);

    if (currentPlatform) {
      // On docs pages - store the current platform
      localStorage.setItem(STORAGE_KEY, currentPlatform);
      setStoredPlatform(currentPlatform as Platform);
    }
    // Note: We don't override stored platform when on non-docs pages
    // This preserves the last visited platform for navigation
  }, [pathname, isClient]);

  return storedPlatform;
}
