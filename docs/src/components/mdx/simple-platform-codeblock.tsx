'use client';

import { PlatformCodeblock, PlatformCodeblockProps } from './platform-codeblock';
import { DEFAULT_FRAMEWORK_PREFERENCES, getPlatformFrameworkConfig } from './platform-config';

// Simplified interface - just provide the code for each platform/framework
export type SimplePlatformCodeblockProps = {
  /**
   * Code examples organized by platform and framework
   * Uses the centralized platform config for language and filename defaults
   */
  code: {
    [platformName: string]: {
      [frameworkName: string]: string | {
        code: string,
        filename?: string, // Override default filename
      },
    },
  },
  /**
   * Which platforms to include (defaults to all platforms in the code object)
   */
  platforms?: string[],
  /**
   * Default platform to show
   */
  defaultPlatform?: string,
  /**
   * Override default framework preferences
   */
  defaultFrameworks?: { [platformName: string]: string },
  /**
   * Optional title for the code block
   */
  title?: string,
  /**
   * Additional CSS classes
   */
  className?: string,
}

export function SimplePlatformCodeblock({
  code,
  platforms: includedPlatforms,
  defaultPlatform,
  defaultFrameworks,
  title,
  className
}: SimplePlatformCodeblockProps) {
  // Determine which platforms to include
  const availablePlatforms = Object.keys(code);
  const platformsToShow = (includedPlatforms || availablePlatforms).filter(
    (platform): platform is keyof typeof code => Object.prototype.hasOwnProperty.call(code, platform)
  );

  // Build the full platform configuration
  const fullPlatforms: PlatformCodeblockProps['platforms'] = {};

  platformsToShow.forEach(platform => {
    fullPlatforms[platform] = {};

    const platformCode = code[platform];

    Object.entries(platformCode).forEach(([framework, codeData]) => {
      const config = getPlatformFrameworkConfig(platform, framework);
      if (!config) {
        console.warn(`Unknown platform/framework combination: ${platform}/${framework}`);
        return;
      }

      const codeString = typeof codeData === 'string' ? codeData : codeData.code;
      const filename = typeof codeData === 'object' && codeData.filename
        ? codeData.filename
        : config.defaultFilename;

      fullPlatforms[platform][framework] = {
        code: codeString,
        language: config.language,
        filename
      };
    });
  });

  // Merge default framework preferences
  const mergedDefaultFrameworks = {
    ...DEFAULT_FRAMEWORK_PREFERENCES,
    ...defaultFrameworks
  };

  return (
    <PlatformCodeblock
      platforms={fullPlatforms}
      defaultPlatform={defaultPlatform}
      defaultFrameworks={mergedDefaultFrameworks}
      title={title}
      className={className}
    />
  );
}

// Export the centralized config for direct access if needed
export { DEFAULT_FRAMEWORK_PREFERENCES, PLATFORM_CONFIG } from './platform-config';

