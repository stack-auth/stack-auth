'use client';

import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";
import { useCodeOverlay } from "../../hooks/use-code-overlay";

type DynamicCodeblockProps = {
  code: string,
  language?: string,
  title?: string,
  useOverlay?: boolean,
}

export function DynamicCodeblock({ code, language = 'tsx', title, useOverlay = true }: DynamicCodeblockProps) {
  const [highlightedCode, setHighlightedCode] = useState<string>("");
  const [hasInitialized, setHasInitialized] = useState(false);
  const { openOverlay, isOpen } = useCodeOverlay();

  // Open overlay by default when using overlay mode (only once per component)
  useEffect(() => {
    if (useOverlay && code && !hasInitialized) {
      // Add a small delay to ensure this runs after the component is fully mounted
      const timer = setTimeout(() => {
        openOverlay(code, language, title);
        setHasInitialized(true);
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [useOverlay, code, language, title, openOverlay, hasInitialized]);

  // Update overlay content when props change (if overlay is open)
  useEffect(() => {
    if (useOverlay && code && hasInitialized && isOpen) {
      openOverlay(code, language, title);
    }
  }, [code, language, title, useOverlay, openOverlay, hasInitialized, isOpen]);

  // Update syntax highlighted code when code changes
  useEffect(() => {
    const updateHighlightedCode = async () => {
      try {
        const html = await codeToHtml(code, {
          lang: language,
          theme: 'github-dark',
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
            }
          }]
        });
        setHighlightedCode(html);
      } catch (error) {
        console.error('Error highlighting code:', error);
        setHighlightedCode(`<pre><code>${code}</code></pre>`);
      }
    };

    // Only highlight code if not using overlay (for fallback)
    if (!useOverlay) {
      // eslint-disable-next-line no-restricted-syntax
      updateHighlightedCode().catch(error => {
        console.error('Error updating highlighted code:', error);
      });
    }
  }, [code, language, useOverlay]);

  // If using overlay mode, show floating button when overlay is closed
  if (useOverlay) {
    return !isOpen ? (
      <button
        onClick={() => openOverlay(code, language, title)}
        className="fixed bottom-6 right-6 z-30 flex items-center gap-2 px-4 py-3 bg-fd-primary text-fd-primary-foreground rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all duration-200 border border-fd-primary/20"
        title="View Code Example"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
        <span className="text-sm font-medium">View Code</span>
      </button>
    ) : null;
  }

  // Fallback to inline code block (for backward compatibility)
  return (
    <div className="space-y-4">
      {title && <h3 className="text-lg font-semibold">{title}</h3>}
      <div className="relative">
        <div
          className="rounded-lg border bg-[#0a0a0a] p-4 overflow-auto max-h-[500px] text-sm"
          style={{
            background: '#0a0a0a !important',
          }}
        >
          <div
            className="[&_*]:!bg-transparent [&_pre]:!bg-transparent [&_code]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </div>
      </div>
    </div>
  );
}
