'use client';

import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";
import { useCodeOverlay } from "../../hooks/use-code-overlay";
import { useSidebar } from "../layouts/sidebar-context";

type DynamicCodeblockProps = {
  code: string,
  language?: string,
  title?: string,
  useOverlay?: boolean,
}

export function DynamicCodeblock({ code, language = 'tsx', title, useOverlay = true }: DynamicCodeblockProps) {
  const [highlightedCode, setHighlightedCode] = useState<string>("");
  const [hasInitialized, setHasInitialized] = useState(false);
  const [windowWidth, setWindowWidth] = useState(0);
  const [isNearBottom, setIsNearBottom] = useState(false);
  const { openOverlay, isOpen } = useCodeOverlay();
  const sidebarContext = useSidebar();
  const isMainSidebarCollapsed = sidebarContext?.isMainSidebarCollapsed ?? false;

  // Handle window resize for responsive positioning
  useEffect(() => {
    const updateWindowWidth = () => {
      if (typeof window !== 'undefined') {
        setWindowWidth(window.innerWidth);
      }
    };

    // Set initial width
    updateWindowWidth();

    // Add resize listener
    window.addEventListener('resize', updateWindowWidth);

    return () => window.removeEventListener('resize', updateWindowWidth);
  }, []);

  // Handle scroll to fade button when near bottom
  useEffect(() => {
    const handleScroll = () => {
      if (typeof window === 'undefined') return;

      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;

      // Calculate distance from bottom (in pixels)
      const distanceFromBottom = documentHeight - (scrollTop + windowHeight);

      // Fade out when within 200px of bottom (where next/prev buttons typically are)
      setIsNearBottom(distanceFromBottom < 200);
    };

    // Set initial state
    handleScroll();

    // Add scroll listener
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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
      // Run async function - all errors are handled within the function
      runAsynchronously(updateHighlightedCode());
    }
  }, [code, language, useOverlay]);

  // If using overlay mode, show floating button when overlay is closed
  if (useOverlay) {
    return !isOpen ? (
      <button
        onClick={() => openOverlay(code, language, title)}
        className="fixed bottom-6 z-30 flex items-center gap-1.5 px-3 py-2 bg-fd-primary text-fd-primary-foreground rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all duration-300 border border-fd-primary/20"
        style={{
          // On mobile: center normally (50%)
          // On desktop: center relative to content area, accounting for sidebar offset
          left: windowWidth < 768 ? '50%' : `calc(50% + ${isMainSidebarCollapsed ? '2rem' : '8rem'})`,
          transform: 'translateX(-50%)',
          // Fade out when near bottom to avoid interfering with next/prev buttons
          opacity: isNearBottom ? 0 : 1,
          pointerEvents: isNearBottom ? 'none' : 'auto'
        }}
        title="View Code Example"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
        <span className="text-xs font-medium">View Code</span>
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
