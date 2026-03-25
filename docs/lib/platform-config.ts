/**
 * Global Platform Configuration
 * 
 * This file defines all supported platforms and frameworks across the documentation.
 * This ensures consistency between code examples, platform selectors, and the header indicator.
 */

export type PlatformName = 'JavaScript' | 'Python' | 'Shell';
export type FrameworkName = string;

export type PlatformConfig = {
  name: PlatformName,
  frameworks: FrameworkName[],
  defaultFramework: FrameworkName,
}

/**
 * All supported platforms and their frameworks
 * Order matters - first platform/framework will be the default
 */
export const PLATFORMS: PlatformConfig[] = [
  {
    name: 'JavaScript',
    frameworks: ['Next.js', 'React', 'Express', 'Node.js', 'Vanilla JavaScript'],
    defaultFramework: 'Next.js',
  },
  {
    name: 'Python',
    frameworks: ['Django', 'FastAPI', 'Flask'],
    defaultFramework: 'Django',
  },
  {
    name: 'Shell',
    frameworks: ['Docker', 'Git', 'pnpm'],
    defaultFramework: 'Docker',
  },
];

/**
 * Default platform to select when no selection exists
 */
export const DEFAULT_PLATFORM: PlatformName = 'JavaScript';
export const DEFAULT_FRAMEWORK = 'Next.js';

/**
 * Get all platform names
 */
export function getAllPlatformNames(): PlatformName[] {
  return PLATFORMS.map(p => p.name);
}

/**
 * Get frameworks for a specific platform
 */
export function getFrameworksForPlatform(platform: PlatformName): FrameworkName[] {
  const config = PLATFORMS.find(p => p.name === platform);
  return config?.frameworks ?? [];
}

/**
 * Get default framework for a platform
 */
export function getDefaultFrameworkForPlatform(platform: PlatformName): FrameworkName {
  const config = PLATFORMS.find(p => p.name === platform);
  return config?.defaultFramework ?? '';
}

/**
 * Check if a platform/framework combination is valid
 */
export function isValidPlatformFramework(platform: string, framework: string): boolean {
  const config = PLATFORMS.find(p => p.name === platform);
  if (!config) return false;
  return config.frameworks.includes(framework);
}

/**
 * Get platform config by name
 */
export function getPlatformConfig(platform: PlatformName): PlatformConfig | undefined {
  return PLATFORMS.find(p => p.name === platform);
}

