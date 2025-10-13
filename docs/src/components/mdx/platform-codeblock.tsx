'use client';

import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { codeToHtml } from 'shiki';
import { getExample, type CodeExample } from '../../../lib/code-examples';
import { cn } from '../../lib/cn';

// Global state management for platform and framework selection
type PlatformChangeListener = (platform: string) => void;
type FrameworkChangeListener = (platform: string, framework: string) => void;

type VariantSelections = Partial<Record<string, Partial<Record<string, 'server' | 'client'>>>>;

const platformListeners = new Map<string, PlatformChangeListener[]>();
const frameworkListeners = new Map<string, FrameworkChangeListener[]>();

let globalSelectedPlatform: string | null = null;
let globalSelectedFrameworks: { [platform: string]: string } = {};

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

/**
 * Converts CodeExample[] from code-examples.ts to the platforms format
 */
function convertExamplesToPlatforms(examples: CodeExample[]) {
  const platforms: {
    [platformName: string]: {
      [frameworkName: string]: {
        code: string,
        language?: string,
        filename?: string,
      } | {
        server: {
          code: string,
          language?: string,
          filename?: string,
        },
        client: {
          code: string,
          language?: string,
          filename?: string,
        },
      },
    },
  } = {};

  const defaultFrameworks: { [platformName: string]: string } = {};
  const defaultVariants: VariantSelections = {};

  for (const example of examples) {
    const { language, framework, variant, code, filename, highlightLanguage } = example;

    // Initialize language if not exists
    if (!(language in platforms)) {
      platforms[language] = {};
    }

    // Set as default framework if first for this language
    if (!(language in defaultFrameworks)) {
      defaultFrameworks[language] = framework;
    }

    if (variant) {
      // Has server/client variant - initialize if not already a variant config
      // We check if 'server' exists to determine if it's already been initialized as a variant config
      if (!('server' in (platforms[language][framework] ?? {}))) {
        platforms[language][framework] = {
          server: { code: '', language: highlightLanguage },
          client: { code: '', language: highlightLanguage }
        };
      }

      const variantConfig = platforms[language][framework] as {
        server: { code: string, language?: string, filename?: string },
        client: { code: string, language?: string, filename?: string },
      };

      // Explicitly narrow the variant type
      const variantType: 'server' | 'client' = variant;
      variantConfig[variantType] = {
        code,
        language: highlightLanguage,
        filename
      };

      // Initialize default variants
      if (!(language in defaultVariants)) {
        defaultVariants[language] = {};
      }
      if (!defaultVariants[language]?.[framework]) {
        defaultVariants[language]![framework] = 'server';
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

  // Determine default platform (first one in the list)
  const defaultPlatform = Object.keys(platforms)[0];

  return { platforms, defaultPlatform, defaultFrameworks, defaultVariants };
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
  const { platforms, defaultPlatform, defaultFrameworks, defaultVariants } = allExamples.length > 0
    ? convertExamplesToPlatforms(allExamples)
    : { platforms: {}, defaultPlatform: '', defaultFrameworks: {}, defaultVariants: {} };

  const platformNames = Object.keys(platforms);
  const firstPlatform = defaultPlatform || platformNames[0];

  // Initialize with global platform or default
  const getInitialPlatform = () => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('stack-docs-selected-platform');
      if (stored && platformNames.includes(stored)) {
        return stored;
      }
    }
    return globalSelectedPlatform && platformNames.includes(globalSelectedPlatform)
      ? globalSelectedPlatform
      : firstPlatform;
  };

  // Initialize global frameworks with defaults if not already set
  const initializeGlobalFrameworks = () => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('stack-docs-selected-frameworks');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          globalSelectedFrameworks = { ...globalSelectedFrameworks, ...parsed };
        } catch (e) {
          // Ignore parsing errors
        }
      }
    }

    // Set defaults for any platforms that don't have a framework selected
    platformNames.forEach(platform => {
      if (!globalSelectedFrameworks[platform]) {
        const frameworks = Object.keys(platforms[platform]);
        globalSelectedFrameworks[platform] = defaultFrameworks[platform] || frameworks[0];
      }
    });
  };

  // Initialize global state on first render
  useEffect(() => {
    initializeGlobalFrameworks();
  });

  const [selectedPlatform, setSelectedPlatform] = useState(getInitialPlatform);
  const [selectedFrameworks, setSelectedFrameworks] = useState<{ [platform: string]: string }>(() => {
    return { ...globalSelectedFrameworks };
  });
  const [selectedVariants, setSelectedVariants] = useState<VariantSelections>(() => {
    return { ...defaultVariants };
  });

  const [highlightedCode, setHighlightedCode] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownView, setDropdownView] = useState<'platform' | 'framework'>('platform');
  // Generate stable ID based on props to avoid hydration mismatches
  const componentId = useMemo(() => {
    const hashString = `${documentPath}-${exampleNames.join(',')}`;
    let hash = 0;
    for (let i = 0; i < hashString.length; i++) {
      const char = hashString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36).substr(0, 9);
  }, [documentPath, exampleNames]);

  // Get current framework options for selected platform
  const currentFrameworks = Object.keys(platforms[selectedPlatform] ?? {});
  const currentFramework = selectedFrameworks[selectedPlatform] || currentFrameworks[0];

  // Helper functions for server/client variants
  const hasVariants = (platform: string, framework: string) => {
    const platformConfig = platforms[platform];
    const config = platformConfig[framework];
    if (typeof config !== 'object') {
      return false;
    }

    return 'server' in config && 'client' in config;
  };

  const getCurrentVariant = (): 'server' | 'client' => {
    const platformVariants = selectedVariants[selectedPlatform];
    return platformVariants?.[currentFramework] ?? 'server';
  };

  const getCurrentCodeConfig = () => {
    if (!Object.prototype.hasOwnProperty.call(platforms, selectedPlatform)) {
      return null;
    }

    const platformConfig = platforms[selectedPlatform];
    if (!Object.prototype.hasOwnProperty.call(platformConfig, currentFramework)) {
      return null;
    }

    const config = platformConfig[currentFramework];

    if (hasVariants(selectedPlatform, currentFramework)) {
      const variant = getCurrentVariant();
      return (config as { server: { code: string, language?: string, filename?: string }, client: { code: string, language?: string, filename?: string } })[variant];
    }

    return config as { code: string, language?: string, filename?: string };
  };

  const currentCodeConfig = getCurrentCodeConfig();

  // Set up global platform synchronization
  useEffect(() => {
    const onPlatformChange = (platform: string) => {
      if (platformNames.includes(platform) && platform !== selectedPlatform) {
        setSelectedPlatform(platform);
      }
    };

    addPlatformListener(componentId, onPlatformChange);

    return () => {
      removePlatformListener(componentId, onPlatformChange);
    };
  }, [componentId, platformNames, selectedPlatform]);

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

    addFrameworkListener(componentId, onFrameworkChange);

    return () => {
      removeFrameworkListener(componentId, onFrameworkChange);
    };
  }, [componentId, platforms]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest(`[data-dropdown-id="${componentId}"]`)) {
        setIsDropdownOpen(false);
        setDropdownView('platform');
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDropdownOpen, componentId]);

  // Update highlighted code when selection changes
  useEffect(() => {
    if (!currentCodeConfig) return;

    const updateHighlightedCode = async () => {
      try {
        // Detect if we're in dark mode
        const isDarkMode = document.documentElement.classList.contains('dark') ||
                          getComputedStyle(document.documentElement).getPropertyValue('--fd-background').includes('0 0% 3.9%');

        const theme = isDarkMode ? 'github-dark' : 'github-light';

        const codeToHighlight = currentCodeConfig.code.startsWith(' ')
          ? currentCodeConfig.code.slice(1)
          : currentCodeConfig.code;

        const html = await codeToHtml(codeToHighlight, {
          lang: currentCodeConfig.language || 'typescript',
          theme,
          transformers: [{
            pre(node) {
              // Remove background styles from pre element
              if (node.properties.style) {
                node.properties.style = (node.properties.style as string).replace(/background[^;]*;?/g, '');
              }
            },
            code(node) {
              // Remove background styles from code element
              if (node.properties.style) {
                node.properties.style = (node.properties.style as string).replace(/background[^;]*;?/g, '');
              }
              // Add consistent styling
              const existingStyle = (node.properties.style as string) || '';
              node.properties.style = `${existingStyle}; line-height: 1.5; font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace; white-space: pre;`;
            }
          }]
        });
        setHighlightedCode(html);
      } catch (error) {
        console.error('Error highlighting code:', error);
        const sanitized = currentCodeConfig.code.startsWith(' ')
          ? currentCodeConfig.code.slice(1)
          : currentCodeConfig.code;
        setHighlightedCode(`<pre><code>${sanitized}</code></pre>`);
      }
    };

    runAsynchronously(updateHighlightedCode);

    // Listen for theme changes
    const observer = new MutationObserver(() => {
      runAsynchronously(updateHighlightedCode);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, [currentCodeConfig]);

  const handlePlatformSelect = (platform: string) => {
    broadcastPlatformChange(platform);
    // Show framework selection for this platform
    setDropdownView('framework');

    // Auto-select first framework of new platform
    const newPlatformFrameworks = Object.keys(platforms[platform] ?? {});
    if (newPlatformFrameworks.length > 0) {
      const firstFramework = defaultFrameworks[platform] || newPlatformFrameworks[0];
      broadcastFrameworkChange(platform, firstFramework);
    }
  };

  const handleFrameworkSelect = (framework: string) => {
    broadcastFrameworkChange(selectedPlatform, framework);
    setIsDropdownOpen(false);
    setDropdownView('platform');
  };

  const handleDropdownToggle = () => {
    setIsDropdownOpen(!isDropdownOpen);
    // Don't reset dropdownView when just opening/closing
    if (!isDropdownOpen) {
      setDropdownView('platform');
    }
  };

  const handleVariantChange = (variant: 'server' | 'client') => {
    setSelectedVariants(prev => ({
      ...prev,
      [selectedPlatform]: {
        ...prev[selectedPlatform],
        [currentFramework]: variant
      }
    }));
  };

  if (platformNames.length === 0) {
    return <div className="text-fd-muted-foreground">No platforms configured</div>;
  }

  return (
    <div className={cn("my-4 relative", className)}>
      <div className="rounded-xl border bg-fd-secondary shadow-sm backdrop-blur-sm overflow-hidden">
        {title && (
          <div className="px-4 py-2 border-b bg-fd-muted/50">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-fd-muted-foreground">{title}</div>
              <div className="flex items-center gap-2">
                {/* File Title in Title Section */}
                {currentCodeConfig?.filename && (
                  <div className="text-xs font-mono text-fd-muted-foreground">
                    {currentCodeConfig.filename}
                  </div>
                )}
                {/* Dropdown Button with Current Selection */}
                <div className="relative" data-dropdown-id={componentId}>
                  <button
                    onClick={handleDropdownToggle}
                    className={cn(
                      "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium transition-all duration-200 ease-out",
                      "text-fd-muted-foreground hover:text-fd-accent-foreground",
                      "before:absolute before:inset-0 before:rounded-lg before:opacity-0 before:transition-opacity before:duration-200",
                      "hover:before:opacity-5",
                      "bg-fd-primary/10 text-fd-primary font-semibold"
                    )}
                  >
                    <span className="text-xs">
                      {selectedPlatform} / {currentFramework}
                    </span>
                    <ChevronDown className={cn(
                      "h-3 w-3 transition-transform duration-200",
                      isDropdownOpen && "rotate-180"
                    )} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Code Content */}
        <div className="relative p-3 text-sm bg-fd-background outline-none dark:bg-[#0A0A0A]">
          {/* Server/Client Tabs (if variants exist) */}
          {hasVariants(selectedPlatform, currentFramework) && (
            <div className="flex items-center gap-1 mb-2">
              {(['server', 'client'] as const).map((variant) => (
                <button
                  key={variant}
                  onClick={() => handleVariantChange(variant)}
                  className={cn(
                    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium transition-all duration-200 ease-out",
                    "text-fd-muted-foreground hover:text-fd-accent-foreground disabled:pointer-events-none disabled:opacity-50",
                    "before:absolute before:inset-0 before:rounded-lg before:opacity-0 before:transition-opacity before:duration-200",
                    "hover:before:opacity-5",
                    getCurrentVariant() === variant && "bg-fd-background text-fd-primary shadow-sm"
                  )}
                >
                  {variant.charAt(0).toUpperCase() + variant.slice(1)}
                </button>
              ))}
            </div>
          )}

          <div className="rounded-lg overflow-auto max-h-[500px]">
            <div
              className="[&_*]:!bg-transparent [&_pre]:!bg-transparent [&_code]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0"
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </div>
        </div>
      </div>

      {/* Single Cascading Dropdown Menu */}
      {isDropdownOpen && (
        <div
          className="absolute right-3 z-50 min-w-[160px] rounded-lg border bg-fd-background shadow-lg"
          style={{
            top: title ? '65px' : '125px',
            right: '12px'
          }}
          data-dropdown-id={componentId}
        >
          {dropdownView === 'platform' ? (
            // Platform Selection View
            <div className="py-1">
              <div className="px-3 py-2 text-xs font-medium text-fd-muted-foreground border-b border-fd-border/30">
                Select Platform
              </div>
              {platformNames.map((platform) => (
                <button
                  key={platform}
                  onClick={() => handlePlatformSelect(platform)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm transition-colors duration-150 flex items-center justify-between",
                    "hover:bg-fd-muted/50 hover:text-fd-accent-foreground",
                    selectedPlatform === platform
                      ? "bg-fd-primary/10 text-fd-primary font-medium"
                      : "text-fd-muted-foreground"
                  )}
                >
                  <span>{platform}</span>
                  <ChevronDown className="h-3 w-3 -rotate-90" />
                </button>
              ))}
            </div>
          ) : (
            // Framework Selection View
            <div className="py-1">
              <div className="flex items-center px-3 py-2 text-xs font-medium text-fd-muted-foreground border-b border-fd-border/30">
                <button
                  onClick={() => setDropdownView('platform')}
                  className="flex items-center gap-1 hover:text-fd-accent-foreground"
                >
                  <ChevronDown className="h-3 w-3 rotate-90" />
                  Back
                </button>
                <span className="ml-2">Select {selectedPlatform} Framework</span>
              </div>
              {currentFrameworks.map((framework) => (
                <button
                  key={framework}
                  onClick={() => handleFrameworkSelect(framework)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm transition-colors duration-150",
                    "hover:bg-fd-muted/50 hover:text-fd-accent-foreground",
                    currentFramework === framework
                      ? "bg-fd-secondary/50 text-fd-foreground font-medium"
                      : "text-fd-muted-foreground"
                  )}
                >
                  {framework}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
