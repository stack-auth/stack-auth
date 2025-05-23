/**
 * Extract the current platform from the URL path
 * @param pathname - The current pathname (e.g., "/docs/pages-next/overview")
 * @returns The platform name (e.g., "next") or null if not found
 */
export function getCurrentPlatform(pathname: string): string | null {
  const match = pathname.match(/^\/docs\/pages-(\w+)/);
  return match ? match[1] : null;
}

/**
 * Generate a platform-specific URL
 * @param platform - The platform name (e.g., "next", "react", "js", "python")
 * @param path - The relative path (e.g., "overview", "components/overview")
 * @returns The full platform-specific URL
 */
export function getPlatformUrl(platform: string, path: string): string {
  return `/docs/pages-${platform}/${path}`;
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
