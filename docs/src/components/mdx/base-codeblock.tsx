'use client';

import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { codeToHtml } from 'shiki';
import { cn } from '../../lib/cn';

export type BaseCodeblockProps = {
  code: string,
  language?: string,
  className?: string,
  children?: ReactNode,
  headerContent?: ReactNode,
  beforeCodeContent?: ReactNode,
  showMetadata?: boolean,
  title?: string,
  filename?: string,
  /** Override the default theme. If not provided, uses github-dark/github-light based on color mode */
  theme?: string,
  /** Custom key to force re-render when theme changes externally */
  themeKey?: string,
  /** Ref to attach to the code container div for measuring line positions */
  codeContainerRef?: React.RefObject<HTMLDivElement>,
};

/**
 * BaseCodeblock - Shared foundation for all code blocks
 *
 * Provides:
 * - Consistent Shiki syntax highlighting
 * - Unified theming (github-dark/github-light)
 * - Standardized container styling
 * - Common font families and spacing
 */
export function BaseCodeblock({
  code,
  language = 'typescript',
  className = '',
  children,
  headerContent,
  beforeCodeContent,
  showMetadata = false,
  title,
  filename,
  theme: customTheme,
  themeKey,
  codeContainerRef,
}: BaseCodeblockProps) {
  const [highlightedCode, setHighlightedCode] = useState<string>('');
  const [isClient, setIsClient] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Check if there's more content to scroll
  const checkScrollability = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      const hasMoreContent = container.scrollHeight > container.clientHeight;
      const isNearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 20;
      setCanScrollDown(hasMoreContent && !isNearBottom);
    }
  }, []);

  // Set up scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      checkScrollability();
      container.addEventListener('scroll', checkScrollability);
      // Also check on resize
      const resizeObserver = new ResizeObserver(checkScrollability);
      resizeObserver.observe(container);

      return () => {
        container.removeEventListener('scroll', checkScrollability);
        resizeObserver.disconnect();
      };
    }
  }, [checkScrollability, highlightedCode]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code.startsWith(' ') ? code.slice(1) : code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Mark when we're on the client to avoid hydration mismatches
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Update highlighted code when code or language changes
  useEffect(() => {
    if (!isClient) return;

    const updateHighlightedCode = async () => {
      try {
        // Use custom theme if provided, otherwise detect dark mode
        let theme: string;
        if (customTheme) {
          theme = customTheme;
        } else {
          const isDarkMode = document.documentElement.classList.contains('dark') ||
                            getComputedStyle(document.documentElement).getPropertyValue('--fd-background').includes('0 0% 3.9%');
          theme = isDarkMode ? 'github-dark' : 'github-light';
        }

        const codeToHighlight = code.startsWith(' ')
          ? code.slice(1)
          : code;

        const html = await codeToHtml(codeToHighlight, {
          lang: language,
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
        const sanitized = code.startsWith(' ') ? code.slice(1) : code;
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
  }, [isClient, code, language, customTheme, themeKey]);

  const hasMetadata = showMetadata && Boolean(title || filename);

  return (
    <div className={`my-4 relative ${className}`}>
      <div className="rounded-xl border border-fd-border/60 bg-fd-card shadow-sm overflow-visible">
        {/* Header with metadata and/or custom header content */}
        {(hasMetadata || headerContent) && (
          <div
            className={`flex flex-wrap items-center gap-3 border-b border-fd-border/60 bg-fd-muted/20 px-4 py-3 ${
              hasMetadata ? "justify-between" : "justify-end"
            }`}
          >
            {hasMetadata && (
              <div className="flex flex-col gap-1 min-w-[160px]">
                {title && (
                  <div className="text-xs font-semibold uppercase tracking-wide text-fd-muted-foreground">
                    {title}
                  </div>
                )}
                {filename && (
                  <div className="text-[11px] font-mono text-fd-muted-foreground/80">
                    {filename}
                  </div>
                )}
              </div>
            )}
            {headerContent}
          </div>
        )}

        {/* Code Content */}
        <div className="group/code relative bg-fd-background px-4 py-4 text-sm outline-none dark:bg-[#0A0A0A] rounded-b-xl">
          {beforeCodeContent}

          {/* Copy button - visible on hover or when copied */}
          <button
            onClick={() => runAsynchronously(handleCopy)}
            className={cn(
              "absolute top-3 right-3 z-10 p-1.5 rounded-md transition-all duration-150",
              "text-fd-muted-foreground hover:text-fd-foreground",
              "bg-fd-muted/50 hover:bg-fd-muted border border-fd-border/50",
              "opacity-0 group-hover/code:opacity-100",
              copied && "opacity-100 text-green-500 hover:text-green-500"
            )}
            title={copied ? "Copied!" : "Copy code"}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>

          <div
            ref={scrollContainerRef}
            className="rounded-lg overflow-auto max-h-[500px] relative"
          >
            <div
              ref={codeContainerRef}
              className="[&_*]:!bg-transparent [&_pre]:!bg-transparent [&_code]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0"
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
            {children}
          </div>

          {/* Scroll indicator with fade gradient - positioned outside scroll container */}
          {canScrollDown && (
            <div className="absolute bottom-4 left-4 right-4 pointer-events-none transition-opacity duration-200">
              {/* Fade gradient */}
              <div className="h-12 bg-gradient-to-t from-fd-background dark:from-[#0A0A0A] to-transparent rounded-b-lg" />

              {/* Scroll indicator */}
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex items-center gap-1 text-xs text-fd-muted-foreground">
                <ChevronDown className="w-3 h-3 animate-bounce" />
                <span className="text-[10px] uppercase tracking-wider font-medium">Scroll</span>
                <ChevronDown className="w-3 h-3 animate-bounce" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

