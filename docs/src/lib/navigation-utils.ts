import { BookOpen, FlaskConical, Hammer, Puzzle, type LucideIcon } from 'lucide-react';
import { getSmartPlatformRedirect } from './platform-navigation';
import type { Platform } from './platform-utils';

export type NavLink = {
  href: string,
  label: string,
  icon: LucideIcon,
}

/**
 * Determines if a platform supports React components
 */
export function platformSupportsComponents(platform: Platform): boolean {
  return ['next', 'react'].includes(platform);
}

/**
 * Determines if a platform supports SDK
 */
export function platformSupportsSDK(platform: Platform): boolean {
  return ['next', 'react', 'js'].includes(platform);
}

/**
 * Determines the appropriate redirect URL when switching platforms.
 * Uses docs-platform.yml to find the best alternative page or falls back to overview.
 */
export function getSmartRedirectUrl(currentPath: string, newPlatform: Platform): string {
  return getSmartPlatformRedirect(currentPath, newPlatform);
}

/**
 * Gets the current platform's URL for the current path
 */
export function getCurrentPlatformUrl(currentPath: string, platform: Platform): string {
  // Check for components section specifically: /docs/{platform}/components/...
  const componentsMatch = currentPath.match(/^\/docs\/[a-z]+\/components(?:\/.*)?$/);
  if (componentsMatch) {
    const componentPath = currentPath.replace(/^\/docs\/[a-z]+\/components/, '');
    return `/docs/${platform}/components${componentPath}`;
  }

  // Check for SDK section specifically: /docs/{platform}/sdk/...
  const sdkMatch = currentPath.match(/^\/docs\/[a-z]+\/sdk(?:\/.*)?$/);
  if (sdkMatch) {
    const sdkPath = currentPath.replace(/^\/docs\/[a-z]+\/sdk/, '');
    return `/docs/${platform}/sdk${sdkPath}`;
  }

  // For general docs within a platform: /docs/{platform}/*
  const generalMatch = currentPath.match(/^\/docs\/[a-z]+(\/.*)$/);
  if (generalMatch) {
    const pathAfterPlatform = generalMatch[1];
    return `/docs/${platform}${pathAfterPlatform}`;
  }

  return `/docs/${platform}/overview`;
}

/**
 * Generates platform-aware navigation links for the shared header.
 * Ensures navigation links point to the correct platform-specific routes.
 * Conditionally includes Components and SDK based on platform support.
 */
export function generateNavLinks(platform: Platform): NavLink[] {
  const baseLinks = [
    {
      href: `/docs/${platform}/overview`,
      label: "Documentation",
      icon: BookOpen
    },
    {
      href: "/api/overview",
      label: "API Reference",
      icon: FlaskConical
    }
  ];

  // Add Components link only for platforms that support React components
  if (platformSupportsComponents(platform)) {
    baseLinks.push({
      href: `/docs/${platform}/components`,
      label: "Components",
      icon: Puzzle
    });
  }

  // Add SDK link only for platforms that support SDK
  if (platformSupportsSDK(platform)) {
    baseLinks.push({
      href: `/docs/${platform}/sdk`,
      label: "SDK",
      icon: Hammer
    });
  }

  return baseLinks;
}
