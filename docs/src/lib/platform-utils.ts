/**
 * Extract the current platform from the URL path
 * @param pathname - The current pathname (e.g., "/docs/next/overview")
 * @returns The platform name (e.g., "next") or null if not found
 */
export function getCurrentPlatform(pathname: string): string | null {
  const match = pathname.match(/^\/docs\/([a-z]+)/);
  if (match) {
    const platform = match[1];
    // Only return if it's a valid platform, not other sections like 'api'
    if (PLATFORMS.includes(platform as Platform)) {
      return platform;
    }
  }
  return null;
}

/**
 * Generate a platform-specific URL
 * @param platform - The platform name (e.g., "next", "react", "js", "python")
 * @param path - The relative path (e.g., "overview", "components/overview")
 * @returns The full platform-specific URL
 */
export function getPlatformUrl(platform: string, path: string): string {
  return `/docs/${platform}/${path}`;
}

/**
 * Available platforms
 */
export const PLATFORMS = ['next', 'react', 'js', 'python'] as const;
export type Platform = typeof PLATFORMS[number];

/**
 * Default platform to redirect to when no platform is specified
 */
export const DEFAULT_PLATFORM: Platform = 'next';
