'use client';

import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Check, ChevronDown, ChevronUp, Code, Copy, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { codeToHtml } from "shiki";
import { cn } from "../../lib/cn";
import { useSidebar } from "../layouts/sidebar-context";

type DynamicCodeblockOverlayProps = {
  code: string,
  language?: string,
  title?: string,
  isOpen?: boolean,
  onToggle?: (isOpen: boolean) => void,
}

export function DynamicCodeblockOverlay({
  code,
  language = 'tsx',
  title = "Code Example",
  isOpen = false,
  onToggle
}: DynamicCodeblockOverlayProps) {
  const [highlightedCode, setHighlightedCode] = useState<string>("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
  const sidebarContext = useSidebar();
  const isMainSidebarCollapsed = sidebarContext?.isMainSidebarCollapsed ?? false;

  // Memoize line count calculation for performance
  const lineCount = useMemo(() => code.split('\n').length, [code]);

  // Calculate dynamic height based on actual code lines and screen size
  const getOptimalHeight = () => {
    const lines = lineCount;
    const viewportHeight = windowSize.height || (typeof window !== 'undefined' ? window.innerHeight : 800);
    const viewportWidth = windowSize.width || (typeof window !== 'undefined' ? window.innerWidth : 1200);

    // Different behavior for mobile vs desktop
    const isMobile = viewportWidth < 768;

    // Calculate available space (subtract header, margins, etc.)
    // Be more conservative since we're using bottom-0 positioning
    const headerHeight = isMobile ? 50 : 60; // Smaller header on mobile
    const margins = isMobile ? 60 : 80; // Much more conservative margins to prevent overflow
    const availableHeight = viewportHeight - headerHeight - margins;

    if (isExpanded) {
      // When expanded, use most of available space but leave some breathing room
      const expandedRatio = isMobile ? 0.7 : 0.75; // More conservative to prevent overflow
      const maxExpandedHeight = Math.min(availableHeight * expandedRatio, isMobile ? 500 : 600);
      return `${maxExpandedHeight}px`;
    }

    // For collapsed state, calculate based on content but respect screen size
    // More generous line height to account for syntax highlighting and larger text
    const lineHeight = isMobile ? 22 : 24; // Increased from 18/20 to 22/24
    const headerAndPadding = isMobile ? 110 : 130; // Slightly more padding
    const buffer = 30; // Extra buffer to prevent cutoff
    const contentHeight = (lines * lineHeight) + headerAndPadding + buffer;

    // Use the smaller of: calculated content height or percentage of available space
    const collapsedRatio = isMobile ? 0.6 : 0.55; // More conservative ratios to prevent overflow
    const maxCollapsedHeight = Math.min(availableHeight * collapsedRatio, isMobile ? 400 : 450); // More conservative max heights
    const optimalHeight = Math.min(contentHeight, maxCollapsedHeight);

    // Ensure minimum height for usability
    const minHeight = Math.min(isMobile ? 200 : 250, availableHeight * 0.3);

    return `${Math.max(optimalHeight, minHeight)}px`;
  };

  // Handle window resize to recalculate optimal height
  useEffect(() => {
    const updateWindowSize = () => {
      if (typeof window !== 'undefined') {
        setWindowSize({ width: window.innerWidth, height: window.innerHeight });
      }
    };

    // Set initial window size
    updateWindowSize();

    // Add resize listener
    window.addEventListener('resize', updateWindowSize);

    return () => window.removeEventListener('resize', updateWindowSize);
  }, []);

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

    // Run async function - all errors are handled within the function
    runAsynchronously(updateHighlightedCode());
  }, [code, language]);

  // Handle copy to clipboard
  const handleCopy = () => {
    const copyToClipboard = async () => {
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        // Handle clipboard error gracefully
        console.error('Failed to copy code:', error instanceof Error ? error.message : 'Unknown error');
        // Could show a toast notification here in the future
      }
    };

    // Run async function - all errors are handled within the function
    runAsynchronously(copyToClipboard);
  };

  // Handle escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onToggle?.(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onToggle]);

  if (!isOpen) return null;

  return (
    <>
      {/* No backdrop - just the overlay */}

      {/* Overlay - positioned to not overlap sidebar */}
      <div
        className={cn(
          "fixed bottom-0 bg-fd-background border-t border-fd-border z-50",
          "transition-all duration-300 ease-out",
          "shadow-2xl",
          "flex flex-col", // Add flex container
          // Position to avoid sidebar overlap - adjust based on sidebar state
          "left-0 right-0",
          isMainSidebarCollapsed ? "md:left-16" : "md:left-64"
        )}
        style={{
          maxHeight: getOptimalHeight(), // Use maxHeight instead of fixed height
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-fd-border bg-fd-muted/30 flex-shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <Code className="h-4 w-4 text-fd-primary flex-shrink-0" />
              <h3 className="font-semibold text-fd-foreground text-sm sm:text-base truncate">{title}</h3>
            </div>
            <div className="text-xs text-fd-muted-foreground bg-fd-muted px-2 py-1 rounded flex-shrink-0">
              {language}
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {/* Copy button */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-fd-muted-foreground hover:text-fd-foreground bg-fd-muted/50 hover:bg-fd-muted rounded-md transition-colors"
              title="Copy code"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy'}</span>
            </button>

            {/* Expand/Collapse button - only show if content would benefit from expansion */}
            {lineCount > 10 && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-fd-muted-foreground hover:text-fd-foreground bg-fd-muted/50 hover:bg-fd-muted rounded-md transition-colors"
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                <span className="hidden sm:inline">{isExpanded ? 'Collapse' : 'Expand'}</span>
              </button>
            )}

            {/* Close button */}
            <button
              onClick={() => onToggle?.(false)}
              className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 text-fd-muted-foreground hover:text-fd-foreground bg-fd-muted/50 hover:bg-fd-muted rounded-md transition-colors"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-auto">
          <div
            className="p-3 sm:p-4"
            style={{
              background: '#0a0a0a'
            }}
          >
            <div
              className="[&_*]:!bg-transparent [&_pre]:!bg-transparent [&_code]:!bg-transparent text-xs sm:text-sm leading-[1.4] sm:leading-[1.5] [&_pre]:text-xs [&_pre]:sm:text-sm [&_code]:text-xs [&_code]:sm:text-sm [&_pre]:leading-[1.4] [&_pre]:sm:leading-[1.5] [&_code]:leading-[1.4] [&_code]:sm:leading-[1.5] [&_pre]:m-0 [&_pre]:p-0 [&_pre]:overflow-visible"
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

// Floating trigger button component
export function CodeBlockTrigger({
  onClick,
  isVisible = true
}: {
  onClick: () => void,
  isVisible?: boolean,
}) {
  if (!isVisible) return null;

  return (
    <button
      onClick={onClick}
      className={cn(
        "fixed bottom-6 z-30",
        "flex items-center gap-1.5 px-3 py-2",
        "bg-fd-primary text-fd-primary-foreground",
        "rounded-full shadow-lg",
        "hover:scale-105 active:scale-95",
        "transition-all duration-200",
        "border border-fd-primary/20"
      )}
      style={{
        left: '50%',
        transform: 'translateX(-50%)'
      }}
      title="View Code Example"
    >
      <Code className="h-3.5 w-3.5" />
      <span className="text-xs font-medium">View Code</span>
    </button>
  );
}
