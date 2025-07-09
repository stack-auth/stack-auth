import { useEffect, useState } from 'react';
import { DEFAULT_PLATFORM, type Platform, PLATFORMS } from '../lib/platform-utils';

const PLATFORM_PREFERENCE_KEY = 'stack-auth-preferred-platform';

/**
 * Hook to manage platform preference persistence in localStorage
 * @returns {Object} { preferredPlatform, setPreferredPlatform, isLoaded }
 */
export function usePlatformPreference() {
  const [preferredPlatform, setPreferredPlatformState] = useState<Platform | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preference from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PLATFORM_PREFERENCE_KEY);
      if (stored && PLATFORMS.includes(stored as Platform)) {
        setPreferredPlatformState(stored as Platform);
      } else {
        setPreferredPlatformState(DEFAULT_PLATFORM);
      }
    } catch (error) {
      console.warn('Failed to load platform preference from localStorage:', error);
      setPreferredPlatformState(DEFAULT_PLATFORM);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Function to update preference in both state and localStorage
  const setPreferredPlatform = (platform: Platform) => {
    setPreferredPlatformState(platform);
    try {
      localStorage.setItem(PLATFORM_PREFERENCE_KEY, platform);
    } catch (error) {
      console.warn('Failed to save platform preference to localStorage:', error);
    }
  };

  return {
    preferredPlatform: preferredPlatform || DEFAULT_PLATFORM,
    setPreferredPlatform,
    isLoaded
  };
}

/**
 * Get the stored platform preference without React hooks (for use in server components or utilities)
 * @returns {Platform} The preferred platform or default platform
 */
export function getStoredPlatformPreference(): Platform {
  if (typeof window === 'undefined') {
    return DEFAULT_PLATFORM;
  }

  try {
    const stored = localStorage.getItem(PLATFORM_PREFERENCE_KEY);
    if (stored && PLATFORMS.includes(stored as Platform)) {
      return stored as Platform;
    }
  } catch (error) {
    console.warn('Failed to get stored platform preference:', error);
  }

  return DEFAULT_PLATFORM;
}
