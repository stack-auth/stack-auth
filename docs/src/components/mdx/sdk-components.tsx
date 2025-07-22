'use client';

import { Palette } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { codeToHtml } from "shiki";
import './clickable-code-styles.css';

// Custom ClickableCodeblock component that includes overlays inside the scrollable area
function ClickableCodeblock({
  code,
  language = 'typescript',
  clickableAreas
}: {
  code: string,
  language?: string,
  clickableAreas: Array<{
    type: 'clickable',
    code: string,
    anchor: string,
    lineNumber: number,
    originalLineNumber: number,
  }>,
}) {
  const [highlightedCode, setHighlightedCode] = useState<string>("");
  const [linePositions, setLinePositions] = useState<Array<{ top: number, height: number }>>([]);
  const [selectedLightTheme, setSelectedLightTheme] = useState<string>('github-light-default');
  const [selectedDarkTheme, setSelectedDarkTheme] = useState<string>('github-dark');
  const [isThemeSwitcherOpen, setIsThemeSwitcherOpen] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);

  // Available themes
  const lightThemes = [
    { value: 'github-light-default', label: 'GitHub Light' },
    { value: 'light-plus', label: 'VS Code Light' },
    { value: 'min-light', label: 'Minimal Light' },
    { value: 'slack-ochin', label: 'Slack Light' },
  ];

  const darkThemes = [
    { value: 'github-dark', label: 'GitHub Dark' },
    { value: 'github-dark-dimmed', label: 'GitHub Dimmed' },
    { value: 'dark-plus', label: 'VS Code Dark' },
    { value: 'dracula', label: 'Dracula' },
  ];

  // Load saved theme preferences on mount
  useEffect(() => {
    const savedLightTheme = localStorage.getItem('stack-docs-light-theme');
    const savedDarkTheme = localStorage.getItem('stack-docs-dark-theme');

    if (savedLightTheme) {
      setSelectedLightTheme(savedLightTheme);
    }
    if (savedDarkTheme) {
      setSelectedDarkTheme(savedDarkTheme);
    }
  }, []);

  // Close theme switcher when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isThemeSwitcherOpen && !(event.target as Element).closest('.theme-switcher-container')) {
        setIsThemeSwitcherOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isThemeSwitcherOpen]);

  // Save theme preferences when they change
  const handleThemeChange = (isDark: boolean, theme: string) => {
    if (isDark) {
      setSelectedDarkTheme(theme);
      localStorage.setItem('stack-docs-dark-theme', theme);
    } else {
      setSelectedLightTheme(theme);
      localStorage.setItem('stack-docs-light-theme', theme);
    }
  };

  // Measure actual line positions after code is rendered
  useEffect(() => {
    if (codeRef.current && highlightedCode) {
      // Wait for fonts to load and CSS to be applied
      const measurePositions = () => {
        const codeElement = codeRef.current?.querySelector('code');
        if (codeElement) {
          // Try different approaches to find line elements
          let lines: NodeListOf<Element> | null = null;

          // First, try to find explicit line elements
          lines = codeElement.querySelectorAll('.line');

          // If no .line elements, try other common patterns
          if (lines.length === 0) {
            lines = codeElement.querySelectorAll('[data-line]');
          }

          if (lines.length > 0) {
            // We found line elements, measure their actual positions
            const containerRect = codeRef.current!.getBoundingClientRect();
            const positions = Array.from(lines).map((line) => {
              const lineRect = line.getBoundingClientRect();
              return {
                top: lineRect.top - containerRect.top,
                height: lineRect.height || 24, // fallback height
              };
            });
            setLinePositions(positions);
          } else {
            // Fallback: manually calculate positions based on text content and font metrics
            const codeText = codeElement.textContent || '';
            const codeLines = codeText.split('\n');

            // Get computed styles for consistent measurements
            const computedStyle = window.getComputedStyle(codeElement);
            let lineHeight = parseFloat(computedStyle.lineHeight);

            // If lineHeight is 'normal' or invalid, calculate from font size
            if (isNaN(lineHeight)) {
              const fontSize = parseFloat(computedStyle.fontSize) || 14;
              lineHeight = fontSize * 1.5; // Use consistent 1.5 multiplier
            }

            // Generate positions for each line
            const positions = codeLines.map((_, index) => ({
              top: index * lineHeight,
              height: lineHeight,
            }));
            setLinePositions(positions);
          }
        }
      };

      // Initial measurement
      measurePositions();

      // Re-measure after delays to account for font loading and rendering
      const timeoutId1 = setTimeout(measurePositions, 100);
      const timeoutId2 = setTimeout(measurePositions, 300);

      // Re-measure on window resize
      const handleResize = () => measurePositions();
      window.addEventListener('resize', handleResize);

      return () => {
        clearTimeout(timeoutId1);
        clearTimeout(timeoutId2);
        window.removeEventListener('resize', handleResize);
      };
    }
  }, [highlightedCode]);

  // Update syntax highlighted code when code changes
  useEffect(() => {
    const updateHighlightedCode = async () => {
      try {
        // Detect if we're in dark mode by checking CSS custom properties or document class
        const isDarkMode = document.documentElement.classList.contains('dark') ||
                          getComputedStyle(document.documentElement).getPropertyValue('--fd-background').includes('0 0% 3.9%');

        // Use selected themes instead of hardcoded ones
        const themeToUse = isDarkMode ? selectedDarkTheme : selectedLightTheme;

        const html = await codeToHtml(code, {
          lang: language,
          theme: themeToUse,
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
              // Add line-height CSS for consistent rendering and preserve whitespace
              const existingStyle = (node.properties.style as string) || '';
              node.properties.style = `${existingStyle}; line-height: 1.5; font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace; white-space: pre;`;
            }
          }]
        });
        setHighlightedCode(html);
      } catch (error) {
        console.error('Error highlighting code:', error);
        setHighlightedCode(`<pre><code>${code}</code></pre>`);
      }
    };

    updateHighlightedCode().catch(error => {
      console.error('Error updating highlighted code:', error);
    });

    // Listen for theme changes on the document element
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          updateHighlightedCode().catch(error => {
            console.error('Error updating highlighted code on theme change:', error);
          });
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => {
      observer.disconnect();
    };
  }, [code, language, selectedLightTheme, selectedDarkTheme]);

  return (
    <div className="space-y-4 mb-6">
      <div className="relative">
        <div
          className="rounded-lg border border-fd-border bg-fd-code p-4 overflow-auto max-h-[500px] text-sm relative clickable-code-container"
          style={{
            fontFamily: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono", monospace',
            lineHeight: '1.5',
          }}
        >
          {/* Theme Switcher */}
          <div className="absolute top-2 right-2 z-10 theme-switcher-container">
            <div className="relative">
              <button
                onClick={() => setIsThemeSwitcherOpen(!isThemeSwitcherOpen)}
                className="p-1.5 rounded-md bg-fd-muted/80 hover:bg-fd-muted text-fd-muted-foreground hover:text-fd-foreground border border-fd-border/50 group"
                title="Choose code syntax highlighting theme for better readability and accessibility"
                aria-label="Code theme selector for accessibility"
              >
                <Palette className="w-4 h-4" />
                {/* Hover tooltip */}
                <div className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-fd-popover text-fd-popover-foreground text-xs rounded border border-fd-border opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-30">
                  Choose syntax theme for accessibility
                </div>
              </button>

              {isThemeSwitcherOpen && (
                <div className="absolute top-full right-0 mt-1 bg-fd-background border border-fd-border rounded-md shadow-md min-w-40 z-20">
                  <div className="p-2">
                    {/* Title */}
                    <div className="text-xs font-medium text-fd-foreground mb-2 pb-1 border-b border-fd-border/30">
                      Code Theme
                    </div>
                    {/* Current mode indicator */}
                    <div>
                      <div className="flex items-center gap-1.5 text-xs text-fd-muted-foreground mb-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${document.documentElement.classList.contains('dark') ? 'bg-slate-600' : 'bg-yellow-400'}`}></div>
                        <span>
                          {document.documentElement.classList.contains('dark') ? 'Dark Mode' : 'Light Mode'}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {(document.documentElement.classList.contains('dark') ? darkThemes : lightThemes).map((theme) => {
                          const isDark = document.documentElement.classList.contains('dark');
                          const isSelected = isDark ? selectedDarkTheme === theme.value : selectedLightTheme === theme.value;
                          return (
                            <button
                              key={theme.value}
                              onClick={() => {
                                handleThemeChange(isDark, theme.value);
                                setIsThemeSwitcherOpen(false);
                              }}
                              className={`w-full flex items-center justify-between px-2 py-1 rounded text-xs transition-all duration-150 ${
                                isSelected
                                  ? 'bg-fd-primary text-fd-primary-foreground font-medium'
                                  : 'hover:bg-fd-accent hover:text-fd-accent-foreground text-fd-foreground'
                              }`}
                              style={{ height: '24px' }}
                            >
                              <span className="flex items-center">{theme.label}</span>
                              {isSelected && (
                                <span className="flex items-center">✓</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div
            ref={codeRef}
            className="[&_*]:!bg-transparent [&_pre]:!bg-transparent [&_code]:!bg-transparent [&_pre]:!leading-6 [&_code]:!leading-6"
            style={{
              fontFamily: 'inherit',
              lineHeight: 'inherit',
            }}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />

          {/* Clickable overlays - now inside the scrollable container */}
          <div className="absolute inset-0 pointer-events-none">
            {clickableAreas.map((area, index) => {
              // Skip if linePositions array is not ready or line index is out of bounds
              if (linePositions.length === 0 || area.lineNumber >= linePositions.length) {
                return null;
              }

              // Use measured line positions instead of calculated ones
              const linePosition = linePositions[area.lineNumber];

              const topPosition = linePosition.top + 16; // 16px is the padding
              const height = linePosition.height;

              return (
                <div
                  key={index}
                  className="absolute left-4 right-4 pointer-events-auto hover:bg-fd-primary/20 rounded cursor-pointer"
                  style={{
                    top: `${topPosition}px`,
                    height: `${height}px`,
                  }}
                  title={`Line ${area.lineNumber + 1}: ${area.anchor} (pos: ${topPosition}px, height: ${height}px)`} // Enhanced debug info
                >
                  <a
                    href={area.anchor}
                    className="block w-full h-full no-underline"
                    aria-label={`Navigate to ${area.anchor}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* Debug info for development */}
      {process.env.NODE_ENV === 'development' && (
        <details className="text-xs text-gray-500">
          <summary>Debug Info (dev only)</summary>
          <pre className="mt-2 p-2 bg-gray-100 rounded text-xs">
            {JSON.stringify({
              linePositions: linePositions.length,
              clickableAreas: clickableAreas.length,
              positions: linePositions.slice(0, 5), // Show first 5 positions
            }, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// SDK Documentation Components
export function Markdown({ src }: { src: string }) {
  // Map of snippet files to their content
  const snippetContent: Record<string, () => React.ReactElement> = {
    '../../snippets/stack-app-constructor-options-before-ssk.mdx': () => (
      <>
        <ParamField path="tokenStore" type="union" required>
          Where to store the user&apos;s session tokens. In most cases, this is `&quot;nextjs-cookie&quot;`, which will store the tokens in cookies using Next.js.

          <Accordion title="Show possible values">
            <ParamField path={`"nextjs-cookie"`} type="string">
              Persists the session tokens in `window.cookie` in browser environments, or Next.js cookies in server environments. This is the most common choice.
            </ParamField>
            <ParamField path={`"cookie"`} type="string">
              Persists the session tokens in `window.cookie` in browser environments. Will not read or write cookies on the server.
            </ParamField>
            <ParamField path={`{ accessToken: string, refreshToken: string }`} type="object">
              Reads the initial value for the session tokens from the provided object. It expects the same format as the object returned by [`currentUser.getAuthJson()`](../types/user.mdx#getauthjson).

              Does not persist changes to the tokens.
            </ParamField>
            <ParamField path="Request" type="object">
              Reads the initial value for the session tokens from headers of the request object. For more information, see the documentation for [`currentUser.getAuthHeaders()`](../types/user.mdx#getauthheaders).

              Does not persist changes to the tokens.
            </ParamField>
          </Accordion>
        </ParamField>
        <ParamField path="baseUrl" type="string">
          The base URL for Stack Auth&apos;s API. Only override this if you are self-hosting Stack Auth. Defaults to `https://api.stack-auth.com`, unless overridden by the `NEXT_PUBLIC_STACK_API_URL` environment variable.
        </ParamField>
        <ParamField path="projectId" type="string">
          The ID of the project that the app is associated with, as found on Stack Auth&apos;s dashboard. Defaults to the value of the `NEXT_PUBLIC_STACK_PROJECT_ID` environment variable.
        </ParamField>
        <ParamField path="publishableClientKey" type="string">
          The publishable client key of the app, as found on Stack Auth&apos;s dashboard. Defaults to the value of the `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY` environment variable.
        </ParamField>
      </>
    ),
    '../../snippets/stack-app-constructor-options-after-ssk.mdx': () => (
      <>
        <ParamField path="urls" type="object">
          The URLs that Stack uses to route and redirect.

          <Accordion title="Show properties">
            <ParamField path="home" type="string">
              The URL of the home page.
            </ParamField>
            <ParamField path="signIn" type="string">
              The URL of the sign-in page.
            </ParamField>
            <ParamField path="afterSignIn" type="string">
              The URL that the user will be redirected to after successful signing in.
            </ParamField>
            <ParamField path="signUp" type="string">
              The URL of the sign-up page.
            </ParamField>
            <ParamField path="afterSignUp" type="string">
              The URL that the user will be redirected to after successful signing up.
            </ParamField>
            <ParamField path="afterSignOut" type="string">
              The URL that the user will be redirected to after successful signing out.
            </ParamField>
            <ParamField path="emailVerification" type="string">
              The URL of the email verification page.
            </ParamField>
            <ParamField path="passwordReset" type="string">
              The URL of the password reset page.
            </ParamField>
            <ParamField path="forgotPassword" type="string">
              The URL of the forgot password page.
            </ParamField>
            <ParamField path="accountSettings" type="string">
              The URL of the account settings page.
            </ParamField>
            <ParamField path="handler" type="string">
              The URL of the handler root.
            </ParamField>
          </Accordion>
        </ParamField>
        <ParamField path="noAutomaticPrefetch" type="boolean">
          By default, the Stack app will automatically prefetch some data from Stack&apos;s server when this app is first constructed. Those network requests may be unnecessary if the app is never used or disposed of immediately. By setting this option to `true`, you can disable the prefetching behavior.
        </ParamField>
      </>
    )
  };

  const ContentComponent = snippetContent[src];

  if (!(src in snippetContent)) {
    console.warn(`Snippet not found: ${src}`);
    return <div className="markdown-include text-red-500">Snippet not found: {src}</div>;
  }

  return <ContentComponent />;
}

export function ParamField({
  path,
  type,
  required,
  children
}: {
  path: string,
  type: string,
  required?: boolean,
  children: React.ReactNode,
}) {
  return (
    <div className="param-field mb-4">
      <div className="param-header flex items-center gap-2 mb-2">
        <code className="param-path bg-fd-muted px-2 py-1 rounded text-sm font-mono font-semibold">
          {path}
        </code>
        <span className="param-type bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 px-2 py-1 rounded text-xs font-medium">
          {type}
        </span>
        {required && (
          <span className="param-required bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 px-2 py-1 rounded text-xs font-medium">
            required
          </span>
        )}
      </div>
      <div className="param-description text-fd-muted-foreground text-sm leading-relaxed">
        {children}
      </div>
    </div>
  );
}

export function Accordion({ title, children }: { title: React.ReactNode, children: React.ReactNode }) {
  return (
    <details className="group mb-3 border border-fd-border/30 rounded-lg bg-fd-card/20">
      <summary className="flex items-center justify-between px-3 py-2 cursor-pointer text-fd-foreground hover:bg-fd-accent/30 rounded-lg list-none [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-medium">{title}</span>
        <svg
          className="w-4 h-4 transition-transform group-open:rotate-180 text-fd-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-3 pb-3 pt-1">
        {children}
      </div>
    </details>
  );
}

export function AccordionGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="accordion-group space-y-3 mb-6">
      {children}
    </div>
  );
}

export function CodeBlocks({ children }: { children: React.ReactNode }) {
  return <div className="code-blocks">{children}</div>;
}

export function Icon({ icon }: { icon: string }) {
  // Simple icon placeholder - you can integrate with your icon system later
  return <span className={`icon ${icon}`} />;
}

type ClickableTableOfContentsProps = {
  code: string,
  platform?: string,
}

export function ClickableTableOfContents({ code, platform = 'react-like' }: ClickableTableOfContentsProps) {
  const lines = code.trim().split('\n');
  let skipNext = false;

  const processedLines = lines.map((line, index) => {
    // Handle skip directive from previous line
    if (skipNext) {
      skipNext = false;
      return null;
    }

    // Handle platform-specific lines
    if (line.trim().startsWith('// NEXT_LINE_PLATFORM')) {
      const platformMatch = line.match(/\/\/ NEXT_LINE_PLATFORM\s+(.+)/);
      const requiredPlatform = platformMatch?.[1]?.trim();

      if (requiredPlatform !== platform) {
        skipNext = true; // Skip the next line
      }
      return null; // Always skip the directive line itself
    }

    // Handle clickable links
    const linkMatch = line.match(/(.+?)\/\/\$stack-link-to:(.+)$/);
    if (linkMatch) {
      const [, codeText, anchor] = linkMatch;

      // Clean up the anchor by removing method parameters if present
      let cleanAnchor = anchor.trim();

      // If the anchor contains method parameters like (data), remove them
      // This handles cases like #currentusercreateteamdata -> #currentusercreateteam
      if (cleanAnchor.includes('(') && cleanAnchor.includes(')')) {
        // Find the method name part before the parameters
        const methodMatch = cleanAnchor.match(/^(#[^(]+)/);
        if (methodMatch) {
          cleanAnchor = methodMatch[1];
        }
      }

      return {
        type: 'clickable' as const,
        code: codeText.trimEnd(), // Only trim trailing whitespace, preserve leading indentation
        anchor: cleanAnchor,
        originalLineIndex: index
      };
    }

    return {
      type: 'normal' as const,
      code: line,
      originalLineIndex: index
    };
  }).filter(item => item !== null);

  // Generate clean TypeScript code for syntax highlighting
  const cleanCode = processedLines.map(item => item.code).join('\n');

  // Generate clickable areas data with accurate line mapping
  const clickableAreas = processedLines
    .filter(item => item.type === 'clickable')
    .map((item) => {
      // Find the actual line number in the rendered code
      const renderedLineIndex = processedLines.findIndex(processedItem => processedItem === item);

      return {
        type: item.type,
        code: item.code,
        anchor: item.anchor,
        lineNumber: renderedLineIndex, // This is the line number in the rendered code
        originalLineNumber: item.originalLineIndex // Keep track of original line number for debugging
      };
    });

  return (
    <ClickableCodeblock
      code={cleanCode}
      language="typescript"
      clickableAreas={clickableAreas}
    />
  );
}
