#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';

/**
 * Generate platform-navigation.ts from docs-platform.yml
 * This ensures we have a single source of truth for platform pages
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_PLATFORM_YML_PATH = path.join(__dirname, '..', 'docs-platform.yml');
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'lib', 'platform-navigation.ts');

function generatePlatformNavigation() {
  try {
    // Read and parse docs-platform.yml
    const yamlContent = fs.readFileSync(DOCS_PLATFORM_YML_PATH, 'utf8');
    const config = parse(yamlContent);

    if (!config.pages || !Array.isArray(config.pages)) {
      throw new Error('Invalid docs-platform.yml format: missing pages array');
    }

    // Validate all platform values
    const validPlatforms = new Set(['next', 'react', 'js', 'python']); // Actual platforms used in docs
    config.pages.forEach((page, idx) => {
      if (!Array.isArray(page.platforms)) {
        throw new Error(`Invalid platforms array at page index ${idx}`);
      }
      page.platforms.forEach(platform => {
        if (!validPlatforms.has(platform)) {
          throw new Error(`Invalid platform "${platform}" at page index ${idx}`);
        }
      });
    });

    // Generate TypeScript content
    const tsContent = `// THIS FILE IS AUTO-GENERATED
// Do not edit manually - update docs-platform.yml instead
// Generated on: ${new Date().toISOString()}

import { type Platform } from './platform-utils';

// Platform pages data auto-generated from docs-platform.yml
const PLATFORM_PAGES: { path: string, platforms: Platform[] }[] = [
${config.pages.map(page => {
  const platformsStr = JSON.stringify(page.platforms);
  return `  { path: ${JSON.stringify(page.path)}, platforms: ${platformsStr} },`;
}).join('\n')}
];

/**
 * Safely join URL path segments
 */
function joinUrlPath(...segments: string[]): string {
  return segments
    .filter(segment => segment && segment.length > 0)
    .join('/')
    .replace(/\\/+/g, '/'); // Remove duplicate slashes
}

/**
 * Check if a specific page exists for a given platform
 */
export function pageExistsForPlatform(path: string, platform: Platform): boolean {
  // Normalize path - remove leading slash and ensure .mdx extension
  const normalizedPath = path.replace(/^\\//, '');
  const pathWithExt = normalizedPath.endsWith('.mdx') ? normalizedPath : \`\${normalizedPath}.mdx\`;

  // First try to find exact match
  let page = PLATFORM_PAGES.find(p => p.path === pathWithExt);

  // If not found and path doesn't end with index, try appending /index.mdx
  if (!page && !pathWithExt.includes('/index.mdx')) {
    const indexPath = normalizedPath.endsWith('.mdx')
      ? normalizedPath.replace('.mdx', '/index.mdx')
      : \`\${normalizedPath}/index.mdx\`;
    page = PLATFORM_PAGES.find(p => p.path === indexPath);
  }

  return page?.platforms.includes(platform) ?? false;
}

/**
 * Get smart redirect URL for platform switching
 * If the current page doesn't exist for the target platform, redirect to overview
 */
export function getSmartPlatformRedirect(currentPath: string, targetPlatform: Platform): string {
  // Remove /docs/{platform}/ prefix and normalize
  const pathWithoutPlatform = currentPath.replace(/^\\/docs\\/[^\\/]+\\//, '');

  // If the exact same page exists for target platform, use it
  if (pageExistsForPlatform(pathWithoutPlatform, targetPlatform)) {
    const cleanPath = pathWithoutPlatform.replace(/\\.mdx$/, '');
    return joinUrlPath('/docs', targetPlatform, cleanPath);
  }

  // Otherwise, redirect to overview
  return joinUrlPath('/docs', targetPlatform, 'overview');
}

/**
 * Get all pages available for a specific platform
 */
export function getPagesForPlatform(platform: Platform): string[] {
  return PLATFORM_PAGES
    .filter(page => page.platforms.includes(platform))
    .map(page => page.path.replace(/\\.mdx$/, ''));
}
`;

    // Write the generated file
    fs.writeFileSync(OUTPUT_PATH, tsContent, 'utf8');

    console.log('✅ Generated platform-navigation.ts from docs-platform.yml');
    console.log(`📄 ${config.pages.length} pages configured for platforms`);

    // Show platform distribution
    const platformCounts = {};
    config.pages.forEach(page => {
      page.platforms.forEach(platform => {
        platformCounts[platform] = (platformCounts[platform] || 0) + 1;
      });
    });

    console.log('📊 Platform distribution:');
    Object.entries(platformCounts).forEach(([platform, count]) => {
      console.log(`   ${platform}: ${count} pages`);
    });

  } catch (error) {
    console.error('❌ Error generating platform-navigation.ts:', error.message);
    process.exit(1);
  }
}

// Run the generator
generatePlatformNavigation();
