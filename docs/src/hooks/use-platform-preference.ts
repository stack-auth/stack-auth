import { useEffect, useState } from 'react';
import { DEFAULT_PLATFORM, type Platform, PLATFORMS } from '../lib/platform-utils';

const PLATFORM_PREFERENCE_KEY = 'stack-auth-preferred-platform';

/**
 * Type guard to check if a value is a valid Platform
 */
function isValidPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && PLATFORMS.includes(value as Platform);
}

/**
 * Hook to manage platform preference persistence in localStorage
 * @returns {Object} { preferredPlatform, setPreferredPlatform, isLoaded }
 */
export function usePlatformPreference() {
  const [preferredPlatform, setPreferredPlatformState] = useState<Platform>(DEFAULT_PLATFORM);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preference from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PLATFORM_PREFERENCE_KEY);
      if (stored && isValidPlatform(stored)) {
        setPreferredPlatformState(stored);
      }
      // If no valid stored preference, keep the DEFAULT_PLATFORM that was set in useState
    } catch (error) {
      console.warn('Failed to load platform preference from localStorage:', error);
      // Keep the DEFAULT_PLATFORM that was set in useState
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Function to update preference in both state and localStorage
  const setPreferredPlatform = (platform: Platform) => {
    if (!isValidPlatform(platform)) {
      console.warn('Invalid platform provided:', platform);
      return;
    }

    setPreferredPlatformState(platform);
    try {
      localStorage.setItem(PLATFORM_PREFERENCE_KEY, platform);
    } catch (error) {
      console.warn('Failed to save platform preference to localStorage:', error);
    }
  };

  return {
    preferredPlatform,
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
    if (stored && isValidPlatform(stored)) {
      return stored;
    }
  } catch (error) {
    console.warn('Failed to get stored platform preference:', error);
  }

  return DEFAULT_PLATFORM;
}
