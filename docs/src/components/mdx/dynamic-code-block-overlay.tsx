'use client';

import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Check, ChevronDown, ChevronUp, Code, Copy, X } from "lucide-react";
import { useEffect, useState } from "react";
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
  const sidebarContext = useSidebar();
  const isMainSidebarCollapsed = sidebarContext?.isMainSidebarCollapsed ?? false;

  // Calculate dynamic height based on actual code lines
  const getOptimalHeight = () => {
    const lines = code.split('\n').length;

    if (isExpanded) {
      // When expanded, be very generous
      return Math.min(lines * 2.5 + 20, 90); // Much more space per line when expanded
    }

    // More generous calculation for collapsed state
    // Be extra generous to prevent any cutting off
    const lineHeightInVh = 1.5; // Very generous estimate per line
    const headerAndPaddingVh = 18; // Extra space for header + padding

    const calculatedHeight = (lines * lineHeightInVh) + headerAndPaddingVh;

    // Even more generous bounds - prioritize showing all content
    return Math.min(Math.max(calculatedHeight, 30), 80); // Min 30vh, Max 80vh when collapsed
  };

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
          "fixed -bottom-11 bg-fd-background border-t border-fd-border z-50",
          "transition-all duration-300 ease-out",
          "shadow-2xl",
          // Position to avoid sidebar overlap - adjust based on sidebar state
          "left-0 right-0",
          isMainSidebarCollapsed ? "md:left-16" : "md:left-64"
        )}
        style={{
          height: `${getOptimalHeight()}vh`,
          maxHeight: '85vh', // Prevent overlay from taking up too much screen space
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-fd-border bg-fd-muted/30">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Code className="h-4 w-4 text-fd-primary" />
              <h3 className="font-semibold text-fd-foreground">{title}</h3>
            </div>
            <div className="text-xs text-fd-muted-foreground bg-fd-muted px-2 py-1 rounded">
              {language}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Copy button */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-fd-muted-foreground hover:text-fd-foreground bg-fd-muted/50 hover:bg-fd-muted rounded-md transition-colors"
              title="Copy code"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>

            {/* Expand/Collapse button - only show if content would benefit from expansion */}
            {code.split('\n').length > 10 && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-fd-muted-foreground hover:text-fd-foreground bg-fd-muted/50 hover:bg-fd-muted rounded-md transition-colors"
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                {isExpanded ? 'Collapse' : 'Expand'}
              </button>
            )}

            {/* Close button */}
            <button
              onClick={() => onToggle?.(false)}
              className="flex items-center justify-center w-8 h-8 text-fd-muted-foreground hover:text-fd-foreground bg-fd-muted/50 hover:bg-fd-muted rounded-md transition-colors"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-auto">
            <div
              className="p-4"
              style={{
                background: '#0a0a0a',
                minHeight: '100%'
              }}
            >
              <div
                className="[&_*]:!bg-transparent [&_pre]:!bg-transparent [&_code]:!bg-transparent text-xs leading-[1.4] [&_pre]:text-xs [&_code]:text-xs [&_pre]:leading-[1.4] [&_code]:leading-[1.4] [&_pre]:m-0 [&_pre]:p-0 [&_pre]:overflow-visible"
                dangerouslySetInnerHTML={{ __html: highlightedCode }}
              />
            </div>
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
        "fixed bottom-6 right-6 z-30",
        "flex items-center gap-2 px-4 py-3",
        "bg-fd-primary text-fd-primary-foreground",
        "rounded-full shadow-lg",
        "hover:scale-105 active:scale-95",
        "transition-all duration-200",
        "border border-fd-primary/20"
      )}
      title="View Code Example"
    >
      <Code className="h-4 w-4" />
      <span className="text-sm font-medium">View Code</span>
    </button>
  );
}
