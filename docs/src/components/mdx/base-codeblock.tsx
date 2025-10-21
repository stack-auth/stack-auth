'use client';

import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { useEffect, useState, type ReactNode } from 'react';
import { codeToHtml } from 'shiki';

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
        <div className="relative bg-fd-background px-4 py-4 text-sm outline-none dark:bg-[#0A0A0A] rounded-b-xl">
          {beforeCodeContent}

          <div className="rounded-lg overflow-auto max-h-[500px] relative">
            <div
              ref={codeContainerRef}
              className="[&_*]:!bg-transparent [&_pre]:!bg-transparent [&_code]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0"
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

