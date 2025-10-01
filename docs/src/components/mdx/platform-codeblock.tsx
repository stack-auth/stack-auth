'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { codeToHtml } from 'shiki';
import { cn } from '../../lib/cn';

// Global state management for platform and framework selection
type PlatformChangeListener = (platform: string) => void;
type FrameworkChangeListener = (platform: string, framework: string) => void;

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

export interface PlatformCodeblockProps {
  /**
   * Platform configurations with their frameworks and code examples
   */
  platforms: {
    [platformName: string]: {
      [frameworkName: string]: {
        code: string;
        language?: string;
        filename?: string;
      };
    };
  };
  /**
   * Default platform to show
   */
  defaultPlatform?: string;
  /**
   * Default framework to show for each platform
   */
  defaultFrameworks?: { [platformName: string]: string };
  /**
   * Optional title for the code block
   */
  title?: string;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export function PlatformCodeblock({
  platforms,
  defaultPlatform,
  defaultFrameworks = {},
  title,
  className
}: PlatformCodeblockProps) {
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
        globalSelectedFrameworks[platform] = defaultFrameworks?.[platform] || frameworks[0];
      }
    });
  };

  // Initialize global state on first render
  useState(() => {
    initializeGlobalFrameworks();
  });
  
  const [selectedPlatform, setSelectedPlatform] = useState(getInitialPlatform);
  const [selectedFrameworks, setSelectedFrameworks] = useState<{ [platform: string]: string }>(() => {
    return { ...globalSelectedFrameworks };
  });
  
  const [highlightedCode, setHighlightedCode] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownView, setDropdownView] = useState<'platform' | 'framework'>('platform');
  const [componentId] = useState(() => Math.random().toString(36).substr(2, 9));

  // Get current framework options for selected platform
  const currentFrameworks = Object.keys(platforms[selectedPlatform] || {});
  const currentFramework = selectedFrameworks[selectedPlatform] || currentFrameworks[0];
  const currentCodeConfig = platforms[selectedPlatform]?.[currentFramework];

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
      if (platforms[platform] && Object.keys(platforms[platform]).includes(framework)) {
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

        const html = await codeToHtml(currentCodeConfig.code, {
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
        setHighlightedCode(`<pre><code>${currentCodeConfig.code}</code></pre>`);
      }
    };

    updateHighlightedCode();

    // Listen for theme changes
    const observer = new MutationObserver(() => {
      updateHighlightedCode();
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
    const newPlatformFrameworks = Object.keys(platforms[platform] || {});
    if (newPlatformFrameworks.length > 0) {
      const firstFramework = defaultFrameworks?.[platform] || newPlatformFrameworks[0];
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
    setDropdownView('platform');
  };

  if (platformNames.length === 0) {
    return <div className="text-fd-muted-foreground">No platforms configured</div>;
  }

  return (
    <div className={cn("my-4 relative", className)}>
      <div className="rounded-xl border bg-fd-secondary shadow-sm backdrop-blur-sm overflow-hidden">
        {title && (
          <div className="px-4 py-2 border-b bg-fd-muted/50">
            <div className="text-xs font-medium text-fd-muted-foreground">{title}</div>
          </div>
        )}
        
        {/* Single Cascading Dropdown */}
        <div className="flex items-center justify-between p-1 text-fd-secondary-foreground overflow-x-auto backdrop-blur-sm not-prose border-b relative">
          {/* Current Selection Display */}
          <div className="flex items-center gap-2 text-sm text-fd-muted-foreground">
            <span className="font-medium text-fd-primary">{selectedPlatform}</span>
            <span>/</span>
            <span>{currentFramework}</span>
          </div>

          {/* Cascading Dropdown - Right Side */}
          <div className="relative" data-dropdown-id={componentId}>
            <button
              onClick={handleDropdownToggle}
              className={cn(
                "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ease-out",
                "text-fd-muted-foreground hover:text-fd-accent-foreground",
                "before:absolute before:inset-0 before:rounded-lg before:opacity-0 before:transition-opacity before:duration-200",
                "hover:before:opacity-5",
                "bg-fd-primary/10 text-fd-primary font-semibold"
              )}
            >
              Change
              <ChevronDown className={cn(
                "h-4 w-4 transition-transform duration-200",
                isDropdownOpen && "rotate-180"
              )} />
            </button>
          </div>
        </div>

        {/* File Title Bar */}
        {currentCodeConfig?.filename && (
          <div className="px-4 py-2 bg-fd-muted/30 border-b border-fd-border/30">
            <div className="text-xs font-mono text-fd-muted-foreground">
              {currentCodeConfig.filename}
            </div>
          </div>
        )}

        {/* Code Content */}
        <div className="relative p-3 text-sm bg-fd-background outline-none">
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
          style={{ top: title ? '85px' : '53px' }}
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
