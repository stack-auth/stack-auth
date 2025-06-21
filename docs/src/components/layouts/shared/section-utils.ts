/**
 * Shared utility functions for documentation layout components
 */

// Helper functions to detect sections
export function isInSdkSection(pathname: string): boolean {
  return /\/docs\/[a-z]+\/sdk(?:\/.*)?$/.test(pathname);
}

export function isInComponentsSection(pathname: string): boolean {
  return /\/docs\/[a-z]+\/components(?:\/.*)?$/.test(pathname);
}

export function isInApiSection(pathname: string): boolean {
  return pathname.startsWith('/api');
}

export function isInCustomizationSection(pathname: string): boolean {
  return /\/docs\/[a-z]+\/customization(?:\/.*)?$/.test(pathname);
}

// Platform display name mapping
export function getPlatformDisplayName(platform: string): string {
  const platformNames: Record<string, string> = {
    'next': 'Next.js',
    'react': 'React',
    'js': 'JavaScript',
    'python': 'Python'
  };
  return platformNames[platform] || platform;
}
