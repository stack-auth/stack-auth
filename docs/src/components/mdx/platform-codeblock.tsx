'use client';

import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getExample, type CodeExample } from '../../../lib/code-examples';
import { DEFAULT_FRAMEWORK, DEFAULT_PLATFORM, PLATFORMS } from '../../../lib/platform-config';
import { cn } from '../../lib/cn';
import { BaseCodeblock } from './base-codeblock';

// Global state management for platform and framework selection
type PlatformChangeListener = (platform: string) => void;
type FrameworkChangeListener = (platform: string, framework: string) => void;

type VariantSelections = Partial<Record<string, Partial<Record<string, string>>>>;

const platformListeners = new Map<string, PlatformChangeListener[]>();
const frameworkListeners = new Map<string, FrameworkChangeListener[]>();

// Initialize with defaults from global config
// Always start with defaults to ensure SSR/client hydration match
let globalSelectedPlatform: string = DEFAULT_PLATFORM;
let globalSelectedFrameworks: { [platform: string]: string } = {
  [DEFAULT_PLATFORM]: DEFAULT_FRAMEWORK
};

// Flag to track if we've loaded from sessionStorage yet
let hasLoadedFromStorage = false;

/**
 * Load stored selections from sessionStorage (client-only)
 * This is called after component mount to avoid hydration mismatches
 */
function loadFromSessionStorage(): void {
  if (hasLoadedFromStorage || typeof window === 'undefined') return;

  const storedPlatform = sessionStorage.getItem('stack-docs-selected-platform');
  if (storedPlatform) {
    globalSelectedPlatform = storedPlatform;
  }

  const storedFrameworks = sessionStorage.getItem('stack-docs-selected-frameworks');
  if (storedFrameworks) {
    try {
      const parsed = JSON.parse(storedFrameworks);
      globalSelectedFrameworks = { ...globalSelectedFrameworks, ...parsed };
    } catch (e) {
      // Ignore parsing errors
    }
  }

  hasLoadedFromStorage = true;
}

function addPlatformListener(id: string, listener: PlatformChangeListener): void {
  const list = platformListeners.get(id) ?? [];
  list.push(listener);
  platformListeners.set(id, list);
}

function removePlatformListener(id: string, listener: PlatformChangeListener): void {
  const list = platformListeners.get(id) ?? [];
  platformListeners.set(
    id,
    list.filter((item) => item !== listener),
  );
}

function addFrameworkListener(id: string, listener: FrameworkChangeListener): void {
  const list = frameworkListeners.get(id) ?? [];
  list.push(listener);
  frameworkListeners.set(id, list);
}

function removeFrameworkListener(id: string, listener: FrameworkChangeListener): void {
  const list = frameworkListeners.get(id) ?? [];
  frameworkListeners.set(
    id,
    list.filter((item) => item !== listener),
  );
}

function broadcastPlatformChange(platform: string): void {
  globalSelectedPlatform = platform;
  // Store in sessionStorage for persistence across page loads
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('stack-docs-selected-platform', platform);
    // Dispatch custom event for external listeners (e.g., header)
    window.dispatchEvent(new CustomEvent('stack-platform-change', { detail: { platform } }));
  }
  // Notify all listeners
  for (const listeners of platformListeners.values()) {
    listeners.forEach(listener => listener(platform));
  }
}

function broadcastFrameworkChange(platform: string, framework: string): void {
  globalSelectedFrameworks[platform] = framework;
  // Store in sessionStorage for persistence across page loads
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('stack-docs-selected-frameworks', JSON.stringify(globalSelectedFrameworks));
    // Dispatch custom event for external listeners (e.g., header)
    window.dispatchEvent(new CustomEvent('stack-framework-change', { detail: { platform, framework } }));
  }
  // Notify all listeners
  for (const listeners of frameworkListeners.values()) {
    listeners.forEach(listener => listener(platform, framework));
  }
}

export type PlatformCodeblockProps = {
  /**
   * Document path in the code-examples.ts file (e.g., "getting-started/setup")
   */
  document: string,
  /**
   * Array of example names to include from the document
   */
  examples: string[],
  /**
   * Optional title for the code block
   */
  title?: string,
  /**
   * Additional CSS classes
   */
  className?: string,
}

type VariantConfig = {
  code: string,
  language?: string,
  filename?: string,
};

type FrameworkConfig = VariantConfig | { [variantName: string]: VariantConfig };

/**
 * Converts CodeExample[] from code-examples.ts to the platforms format
 * Only includes platforms/frameworks defined in the global config
 */
function convertExamplesToPlatforms(examples: CodeExample[]) {
  const platforms: {
    [platformName: string]: {
      [frameworkName: string]: FrameworkConfig,
    },
  } = {};

  const defaultFrameworks: { [platformName: string]: string } = {};
  const defaultVariants: VariantSelections = {};
  // Track which variants exist for each platform/framework
  const variantKeys: { [platform: string]: { [framework: string]: string[] } } = {};

  // Initialize default frameworks from global config
  for (const platformConfig of PLATFORMS) {
    defaultFrameworks[platformConfig.name] = platformConfig.defaultFramework;
  }

  for (const example of examples) {
    const { language, framework, variant, code, filename, highlightLanguage } = example;

    // Skip if this platform/framework is not in our global config
    const platformConfig = PLATFORMS.find(p => p.name === language);
    if (!platformConfig) {
      console.warn(`Platform "${language}" not found in global config, skipping`);
      continue;
    }
    if (!platformConfig.frameworks.includes(framework)) {
      console.warn(`Framework "${framework}" not found in platform "${language}" config, skipping`);
      continue;
    }

    // Initialize language if not exists
    if (!(language in platforms)) {
      platforms[language] = {};
    }

    if (variant) {
      // Has variant - initialize tracking if needed
      if (!(language in variantKeys)) {
        variantKeys[language] = {};
      }
      if (!(framework in variantKeys[language])) {
        variantKeys[language][framework] = [];
      }

      // Track this variant key
      if (!variantKeys[language][framework].includes(variant)) {
        variantKeys[language][framework].push(variant);
      }

      // Initialize framework config as variant object if needed
      const existingConfig = platforms[language][framework] as FrameworkConfig | undefined;
      if (existingConfig === undefined || 'code' in existingConfig) {
        platforms[language][framework] = {};
      }

      const variantConfig = platforms[language][framework] as { [key: string]: VariantConfig };
      variantConfig[variant] = {
        code,
        language: highlightLanguage,
        filename
      };

      // Initialize default variants (use first variant seen)
      if (!(language in defaultVariants)) {
        defaultVariants[language] = {};
      }
      if (!defaultVariants[language]?.[framework]) {
        defaultVariants[language]![framework] = variant;
      }
    } else {
      // No variant
      platforms[language][framework] = {
        code,
        language: highlightLanguage,
        filename
      };
    }
  }

  // Sort platforms according to global config order - only include platforms with examples
  const sortedPlatforms: typeof platforms = {};
  for (const platformConfig of PLATFORMS) {
    const platform = platforms[platformConfig.name] as typeof platforms[string] | undefined;
    // Only include platforms that have examples in this code block
    if (platform) {
      sortedPlatforms[platformConfig.name] = platform;
    }
  }
  // Use the global default platform, or fallback to first available
  const defaultPlatform = DEFAULT_PLATFORM in sortedPlatforms
    ? DEFAULT_PLATFORM
    : Object.keys(sortedPlatforms)[0];

  return { platforms: sortedPlatforms, defaultPlatform, defaultFrameworks, defaultVariants, variantKeys };
}

export function PlatformCodeblock({
  document: documentPath,
  examples: exampleNames,
  title,
  className
}: PlatformCodeblockProps) {
  // Load and convert examples from the centralized code-examples.ts file
  const allExamples: CodeExample[] = [];

  for (const exampleName of exampleNames) {
    const examples = getExample(documentPath, exampleName);
    if (!examples) {
      console.warn(`Example "${exampleName}" not found in document "${documentPath}"`);
      continue;
    }
    allExamples.push(...examples);
  }

  // Convert to the internal platforms format
  const { platforms, defaultPlatform, defaultFrameworks, defaultVariants, variantKeys } = allExamples.length > 0
    ? convertExamplesToPlatforms(allExamples)
    : { platforms: {}, defaultPlatform: '', defaultFrameworks: {}, defaultVariants: {}, variantKeys: {} };

  const platformNames = Object.keys(platforms);
  const firstPlatform = defaultPlatform || platformNames[0];

  // Initialize with global platform or default
  // Important: This must return the same value on server and client for hydration
  const getInitialPlatform = () => {
    // Always prefer the global default if available in this component
    if (platformNames.includes(DEFAULT_PLATFORM)) {
      return DEFAULT_PLATFORM;
    }

    // Fallback to first available platform
    return firstPlatform;
  };

  // ALL useState HOOKS MUST BE AT THE TOP
  const [selectedPlatform, setSelectedPlatform] = useState(getInitialPlatform);
  const [pendingPlatform, setPendingPlatform] = useState<string | null>(null);
  const [selectedFrameworks, setSelectedFrameworks] = useState<{ [platform: string]: string }>(() => {
    // Initialize with defaults from config to ensure SSR/client hydration match
    const initial: { [platform: string]: string } = {};
    platformNames.forEach(platform => {
      const frameworks = Object.keys(platforms[platform] ?? {});
      if (frameworks.length > 0) {
        initial[platform] = defaultFrameworks[platform] || frameworks[0];
      }
    });
    return initial;
  });
  const [selectedVariants, setSelectedVariants] = useState<VariantSelections>(() => {
    return { ...defaultVariants };
  });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownView, setDropdownView] = useState<'platform' | 'framework'>('platform');

  // Initialize global frameworks with defaults if not already set
  const initializeGlobalFrameworks = useCallback(() => {
    // Set defaults for platforms that don't have selections
    platformNames.forEach(platform => {
      if (!globalSelectedFrameworks[platform]) {
        const frameworks = Object.keys(platforms[platform]);
        if (frameworks.length > 0) {
          // Use default from global config first, then fall back to first available
          globalSelectedFrameworks[platform] = defaultFrameworks[platform] || frameworks[0];
        }
      }
    });
  }, [platformNames, platforms, defaultFrameworks]);

  // Initialize global state on first render (client-only to avoid hydration issues)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Load from sessionStorage first
    loadFromSessionStorage();

    // Then initialize frameworks
    initializeGlobalFrameworks();

    // Check if the globally selected platform exists in this code block
    let platformToUse = getInitialPlatform();
    if (globalSelectedPlatform && platformNames.includes(globalSelectedPlatform)) {
      platformToUse = globalSelectedPlatform;
    } else if (globalSelectedPlatform && !platformNames.includes(globalSelectedPlatform)) {
      // Global selection doesn't exist in this code block, use first available
      platformToUse = getInitialPlatform();
    }

    // Update platform if different from initial
    const initialPlatform = getInitialPlatform();
    if (platformToUse !== initialPlatform) {
      setSelectedPlatform(platformToUse);
    }

    // Check if the selected framework exists for this platform
    const availableFrameworks = Object.keys(platforms[platformToUse] ?? {});
    let frameworkToUse = globalSelectedFrameworks[platformToUse];

    // If the global framework doesn't exist for this platform, use first available
    if (!frameworkToUse || !availableFrameworks.includes(frameworkToUse)) {
      frameworkToUse = defaultFrameworks[platformToUse] || availableFrameworks[0];
    }

    // Update framework selections
    const storedFrameworks = { ...globalSelectedFrameworks };
    if (frameworkToUse && storedFrameworks[platformToUse] !== frameworkToUse) {
      storedFrameworks[platformToUse] = frameworkToUse;
    }
    setSelectedFrameworks(storedFrameworks);
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Generate stable ID based on props to avoid hydration mismatches
  const componentId = useMemo(() => {
    const hashString = `${documentPath}-${exampleNames.join(',')}`;
    let hash = 0;
    for (let i = 0; i < hashString.length; i++) {
      const char = hashString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36).slice(0, 9);
  }, [documentPath, exampleNames]);

  // Get current framework options for selected (or pending) platform
  const activePlatform = pendingPlatform || selectedPlatform;
  const currentFrameworks = Object.keys(platforms[activePlatform] ?? {});
  const currentFramework = selectedFrameworks[activePlatform] || currentFrameworks[0];

  // Helper functions for variants (supports dynamic variant names like 'server'/'client' or 'html'/'script')
  const getVariantKeys = (platform: string, framework: string): string[] => {
    if (!(platform in variantKeys)) return [];
    const platformVariants = variantKeys[platform];
    if (!(framework in platformVariants)) return [];
    return platformVariants[framework];
  };

  const hasVariants = (platform: string, framework: string) => {
    return getVariantKeys(platform, framework).length > 0;
  };

  const getCurrentVariant = (): string => {
    const platformVariants = selectedVariants[selectedPlatform];
    const keys = getVariantKeys(selectedPlatform, currentFramework);
    const selectedVariant = platformVariants?.[currentFramework];
    if (selectedVariant) return selectedVariant;
    return keys[0] || '';
  };

  const getCurrentCodeConfig = () => {
    // Get platform config - fall back to first available platform if selected doesn't exist
    let platformToUse = selectedPlatform;
    if (!(platformToUse in platforms)) {
      // Selected platform doesn't exist in this code block, fall back to first available
      platformToUse = platformNames[0];
      if (!platformToUse) {
        return null;
      }
    }
    const platformConfig = platforms[platformToUse];

    // Get framework config - fall back to first available framework if selected doesn't exist
    let frameworkToUse = currentFramework;
    const availableFrameworks = Object.keys(platformConfig);
    if (!(frameworkToUse in platformConfig)) {
      // Selected framework doesn't exist, fall back to first available
      frameworkToUse = availableFrameworks[0];
      if (!frameworkToUse) {
        return null;
      }
    }
    const config = platformConfig[frameworkToUse];

    if (hasVariants(platformToUse, frameworkToUse)) {
      const keys = getVariantKeys(platformToUse, frameworkToUse);
      const platformVariants = selectedVariants[platformToUse];
      const variant = platformVariants?.[frameworkToUse] || keys[0] || '';
      return (config as { [key: string]: VariantConfig })[variant];
    }

    return config as VariantConfig;
  };

  const currentCodeConfig = getCurrentCodeConfig();

  // Set up global platform synchronization
  useEffect(() => {
    const onPlatformChange = (platform: string) => {
      // Check if the new platform exists in this code block
      if (platformNames.includes(platform) && platform !== selectedPlatform) {
        // Platform exists, switch to it
        setSelectedPlatform(platform);
      } else if (!platformNames.includes(platform) && selectedPlatform !== firstPlatform) {
        // Platform doesn't exist in this code block, fall back to first available
        setSelectedPlatform(firstPlatform);
      }
    };

    // Listen to internal callback system (from other codeblocks)
    addPlatformListener(componentId, onPlatformChange);

    // Also listen to window events (from header or other sources)
    const handleWindowPlatformChange = ((e: CustomEvent) => {
      onPlatformChange(e.detail.platform);
    }) as EventListener;

    window.addEventListener('stack-platform-change', handleWindowPlatformChange);

    return () => {
      removePlatformListener(componentId, onPlatformChange);
      window.removeEventListener('stack-platform-change', handleWindowPlatformChange);
    };
  }, [componentId, platformNames, selectedPlatform, firstPlatform]);

  // Set up global framework synchronization
  useEffect(() => {
    const onFrameworkChange = (platform: string, framework: string) => {
      // Only update if this platform exists in our platforms and the framework is available
      if (platform in platforms && Object.keys(platforms[platform]).includes(framework)) {
        setSelectedFrameworks(prev => ({
          ...prev,
          [platform]: framework
        }));
      }
    };

    // Listen to internal callback system (from other codeblocks)
    addFrameworkListener(componentId, onFrameworkChange);

    // Also listen to window events (from header or other sources)
    const handleWindowFrameworkChange = ((e: CustomEvent) => {
      onFrameworkChange(e.detail.platform, e.detail.framework);
    }) as EventListener;

    window.addEventListener('stack-framework-change', handleWindowFrameworkChange);

    return () => {
      removeFrameworkListener(componentId, onFrameworkChange);
      window.removeEventListener('stack-framework-change', handleWindowFrameworkChange);
    };
  }, [componentId, platforms]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest(`[data-dropdown-id="${componentId}"]`)) {
        setIsDropdownOpen(false);
        setDropdownView('platform');
        setPendingPlatform(null); // Clear pending selection
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDropdownOpen, componentId]);


  const handlePlatformSelect = (platform: string) => {
    // Store pending platform but don't apply it yet
    setPendingPlatform(platform);
    setDropdownView('framework');
  };

  const handleFrameworkSelect = (framework: string) => {
    // Use pending platform if available, otherwise current platform
    const platformToUse = pendingPlatform || selectedPlatform;

    // Now apply the platform change
    setSelectedPlatform(platformToUse);
    setPendingPlatform(null);

    // Broadcast both platform and framework changes
    broadcastPlatformChange(platformToUse);
    broadcastFrameworkChange(platformToUse, framework);

    setIsDropdownOpen(false);
    setDropdownView('platform');
  };

  const toggleDropdown = () => {
    setIsDropdownOpen(prev => {
      const next = !prev;
      if (next) {
        setDropdownView('platform');
      } else {
        // Closing dropdown - clear pending platform if any
        setPendingPlatform(null);
      }
      return next;
    });
  };

  const handleVariantChange = (variant: string) => {
    setSelectedVariants(prev => ({
      ...prev,
      [selectedPlatform]: {
        ...(prev[selectedPlatform] ?? {}),
        [currentFramework]: variant
      }
    }));
  };

  if (platformNames.length === 0) {
    return <div className="text-fd-muted-foreground">No platforms configured</div>;
  }

  return (
    <div data-dropdown-id={componentId}>
      <BaseCodeblock
        code={currentCodeConfig?.code || ''}
        language={currentCodeConfig?.language || 'typescript'}
        className={className}
        showMetadata={true}
        title={title}
        filename={currentCodeConfig?.filename}
        headerContent={
          <div className="relative ml-auto">
            <button
              onClick={toggleDropdown}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border border-fd-border/70 bg-fd-background/80 px-3 py-1.5 text-sm font-medium text-fd-foreground shadow-sm transition-all duration-150",
                "hover:border-fd-primary/50 hover:bg-fd-primary/5 hover:shadow-md"
              )}
            >
              <span className="flex items-center gap-1">
                {selectedPlatform} / {selectedFrameworks[selectedPlatform] || Object.keys(platforms[selectedPlatform] ?? {})[0]}
              </span>
              <ChevronDown
                className={cn(
                  "h-3 w-3 text-fd-muted-foreground transition-transform duration-200",
                  isDropdownOpen && "rotate-180"
                )}
              />
            </button>

            {isDropdownOpen && (
              <div className="absolute right-0 top-full z-[200] mt-1 min-w-[220px] rounded-lg border border-fd-border/70 bg-fd-background shadow-lg">
                {dropdownView === 'platform' ? (
                  <div className="py-1">
                    <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fd-muted-foreground">
                      Choose Platform
                    </div>
                    {platformNames.map((platform) => (
                      <button
                        key={platform}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlatformSelect(platform);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between px-3 py-1.5 text-sm transition-all duration-150",
                          "hover:bg-fd-primary/10 hover:text-fd-primary hover:font-medium",
                          selectedPlatform === platform
                            ? "bg-fd-primary/15 text-fd-primary font-semibold"
                            : "text-fd-muted-foreground"
                        )}
                      >
                        <span>{platform}</span>
                        <ChevronDown className="h-3 w-3 -rotate-90 text-fd-muted-foreground/80" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-1">
                    <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fd-muted-foreground">
                      <button
                        onClick={() => {
                          setDropdownView('platform');
                          setPendingPlatform(null); // Clear pending when going back
                        }}
                        className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fd-muted-foreground hover:text-fd-primary"
                      >
                        <ChevronDown className="h-3 w-3 rotate-90" />
                        Back
                      </button>
                      <span className="truncate">{pendingPlatform || selectedPlatform}</span>
                    </div>
                    {currentFrameworks.map((framework) => (
                      <button
                        key={framework}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFrameworkSelect(framework);
                        }}
                        className={cn(
                          "w-full px-3 py-1.5 text-sm text-left",
                          "hover:bg-fd-primary/10 hover:text-fd-primary hover:font-medium",
                          currentFramework === framework
                            ? "bg-fd-primary/15 text-fd-primary font-semibold"
                            : "text-fd-muted-foreground"
                        )}
                      >
                        <span className="flex items-center gap-2">
                          {framework}
                          {currentFramework === framework && (
                            <span className="text-[10px] text-fd-primary/70 font-medium">current</span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        }
        beforeCodeContent={
          // Use selectedPlatform (not pending) to determine if variants should show
          // This ensures variant buttons don't disappear during platform selection
          hasVariants(selectedPlatform, selectedFrameworks[selectedPlatform] || Object.keys(platforms[selectedPlatform] ?? {})[0]) ? (
            <div className="mb-3 flex">
              <div className="inline-flex items-center gap-1 rounded-full border border-fd-border/60 bg-fd-muted/20 p-1">
                {getVariantKeys(selectedPlatform, currentFramework).map((variant) => {
                  // Get the filename for this variant to use as label
                  const config = platforms[selectedPlatform][currentFramework] as { [key: string]: VariantConfig } | undefined;
                  const variantConfig = config?.[variant];
                  const label = variantConfig?.filename || variant.charAt(0).toUpperCase() + variant.slice(1);

                  return (
                    <button
                      key={variant}
                      onClick={() => handleVariantChange(variant)}
                      className={cn(
                        "inline-flex items-center justify-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150",
                        getCurrentVariant() === variant
                          ? "bg-fd-background text-fd-foreground shadow-sm border border-fd-border"
                          : "border border-transparent text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/40"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
