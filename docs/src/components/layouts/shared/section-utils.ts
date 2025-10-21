/**
 * Shared utility functions for documentation layout components
 */

// Helper functions to detect sections
const PLATFORM_PREFIX = '(?:[a-z-]+/)?';

export function isInSdkSection(pathname: string): boolean {
  return new RegExp(`^/docs/${PLATFORM_PREFIX}sdk(?:/.*)?$`).test(pathname);
}

export function isInComponentsSection(pathname: string): boolean {
  return new RegExp(`^/docs/${PLATFORM_PREFIX}components(?:/.*)?$`).test(pathname);
}

export function isInApiSection(pathname: string): boolean {
  return pathname.startsWith('/api');
}

export function isInCustomizationSection(pathname: string): boolean {
  return new RegExp(`^/docs/${PLATFORM_PREFIX}customization(?:/.*)?$`).test(pathname);
}
