'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_FRAMEWORK, DEFAULT_PLATFORM, getFrameworksForPlatform, type PlatformName, PLATFORMS } from '../../../lib/platform-config';
import { cn } from '../../lib/cn';

/**
 * Platform Indicator & Selector Component
 *
 * Displays and allows selection of the current platform and framework.
 * Changes are broadcast globally to all PlatformCodeblock components.
 * Minimal design with dropdown selector.
 */
export function PlatformIndicator({ className }: { className?: string }) {
  const [platform, setPlatform] = useState<string>(DEFAULT_PLATFORM);
  const [framework, setFramework] = useState<string>(DEFAULT_FRAMEWORK);
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownView, setDropdownView] = useState<'platform' | 'framework'>('platform');

  // Generate stable ID for click-outside detection
  const componentId = useMemo(() => 'platform-indicator-header', []);

  useEffect(() => {
    // Initial load from sessionStorage
    const updateFromStorage = () => {
      const storedPlatform = sessionStorage.getItem('stack-docs-selected-platform');
      const storedFrameworks = sessionStorage.getItem('stack-docs-selected-frameworks');

      if (storedPlatform) {
        setPlatform(storedPlatform);

        if (storedFrameworks) {
          try {
            const frameworks = JSON.parse(storedFrameworks);
            const currentFramework = frameworks[storedPlatform];
            if (currentFramework) {
              setFramework(currentFramework);
            }
          } catch (e) {
            // Ignore parsing errors, keep defaults
          }
        }
      } else {
        // No stored platform, use defaults
        setPlatform(DEFAULT_PLATFORM);
        setFramework(DEFAULT_FRAMEWORK);
      }
    };

    // Initial update
    updateFromStorage();

    // Listen for storage events (updates from other components/tabs)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'stack-docs-selected-platform' || e.key === 'stack-docs-selected-frameworks') {
        updateFromStorage();
      }
    };

    // Listen for custom events from platform-codeblock
    const handlePlatformChange = ((e: CustomEvent) => {
      setPlatform(e.detail.platform);
      updateFromStorage();
    }) as EventListener;

    const handleFrameworkChange = ((e: CustomEvent) => {
      if (e.detail.platform === platform) {
        setFramework(e.detail.framework);
      }
      updateFromStorage();
    }) as EventListener;

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('stack-platform-change', handlePlatformChange);
    window.addEventListener('stack-framework-change', handleFrameworkChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('stack-platform-change', handlePlatformChange);
      window.removeEventListener('stack-framework-change', handleFrameworkChange);
    };
  }, [platform]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest(`[data-dropdown-id="${componentId}"]`)) {
        setIsOpen(false);
        setDropdownView('platform');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, componentId]);

  const handlePlatformSelect = (selectedPlatform: string) => {
    // Broadcast the platform change
    sessionStorage.setItem('stack-docs-selected-platform', selectedPlatform);
    window.dispatchEvent(new CustomEvent('stack-platform-change', { detail: { platform: selectedPlatform } }));
    setPlatform(selectedPlatform);

    // Move to framework selection
    setDropdownView('framework');
  };

  const handleFrameworkSelect = (selectedFramework: string) => {
    // Broadcast the framework change
    const storedFrameworks = sessionStorage.getItem('stack-docs-selected-frameworks');
    let frameworks: Record<string, string> = {};
    if (storedFrameworks) {
      try {
        frameworks = JSON.parse(storedFrameworks);
      } catch (e) {
        // Ignore
      }
    }
    frameworks[platform] = selectedFramework;
    sessionStorage.setItem('stack-docs-selected-frameworks', JSON.stringify(frameworks));
    window.dispatchEvent(new CustomEvent('stack-framework-change', { detail: { platform, framework: selectedFramework } }));

    setFramework(selectedFramework);
    setIsOpen(false);
    setDropdownView('platform');
  };

  const currentFrameworks = getFrameworksForPlatform(platform as PlatformName);

  return (
    <div data-dropdown-id={componentId} className="relative">
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) {
            setDropdownView('platform');
          }
        }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-fd-border/50 bg-fd-background/80 px-2.5 py-1 text-xs font-medium text-fd-foreground transition-colors",
          "hover:border-fd-primary/50 hover:bg-fd-primary/5",
          className
        )}
      >
        <span className="flex items-center gap-1">
          {platform} / {framework}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-fd-muted-foreground transition-transform duration-150",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-[200] mt-1 min-w-[200px] rounded-lg border border-fd-border/70 bg-fd-background shadow-lg">
          {dropdownView === 'platform' ? (
            <div className="py-1">
              <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-fd-muted-foreground">
                Platform
              </div>
              {PLATFORMS.map((platformConfig) => (
                <button
                  key={platformConfig.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlatformSelect(platformConfig.name);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors",
                    "hover:bg-fd-primary/10 hover:text-fd-primary",
                    platform === platformConfig.name
                      ? "bg-fd-primary/15 text-fd-primary font-medium"
                      : "text-fd-muted-foreground"
                  )}
                >
                  <span>{platformConfig.name}</span>
                  <ChevronDown className="h-3 w-3 -rotate-90" />
                </button>
              ))}
            </div>
          ) : (
            <div className="py-1">
              <div className="flex items-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-fd-muted-foreground">
                <button
                  onClick={() => setDropdownView('platform')}
                  className="mr-2 flex items-center gap-1 hover:text-fd-primary"
                >
                  <ChevronDown className="h-3 w-3 rotate-90" />
                  Back
                </button>
                <span>Framework</span>
              </div>
              {currentFrameworks.map((fw) => (
                <button
                  key={fw}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFrameworkSelect(fw);
                  }}
                  className={cn(
                    "w-full px-3 py-1.5 text-sm text-left transition-colors",
                    "hover:bg-fd-primary/10 hover:text-fd-primary",
                    framework === fw
                      ? "bg-fd-primary/15 text-fd-primary font-medium"
                      : "text-fd-muted-foreground"
                  )}
                >
                  {fw}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

