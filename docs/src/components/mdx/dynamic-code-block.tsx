'use client';

import { Code } from "lucide-react";
import { useEffect, useState } from "react";
import { useCodeOverlay } from "../../hooks/use-code-overlay";
import { cn } from "../../lib/cn";
import { useSidebar } from "../layouts/sidebar-context";

type DynamicCodeblockProps = {
  code: string,
  language?: string,
  title?: string,
}

/**
 * DynamicCodeblock - Trigger component for code overlay
 *
 * Auto-opens the code overlay and shows a floating "View Code" button when closed.
 * The actual code rendering is handled by DynamicCodeblockOverlay (global in layout).
 */
export function DynamicCodeblock({
  code,
  language = 'tsx',
  title = "Code Example"
}: DynamicCodeblockProps) {
  const [hasInitialized, setHasInitialized] = useState(false);
  const [windowWidth, setWindowWidth] = useState(0);
  const [isNearBottom, setIsNearBottom] = useState(false);
  const { openOverlay, isOpen } = useCodeOverlay();
  const sidebarContext = useSidebar();
  const isMainSidebarCollapsed = sidebarContext?.isMainSidebarCollapsed ?? false;

  // Handle window resize for responsive button positioning
  useEffect(() => {
    const updateWindowWidth = () => {
      if (typeof window !== 'undefined') {
        setWindowWidth(window.innerWidth);
      }
    };

    updateWindowWidth();
    window.addEventListener('resize', updateWindowWidth);

    return () => window.removeEventListener('resize', updateWindowWidth);
  }, []);

  // Handle scroll to fade button when near bottom (avoid overlapping with next/prev buttons)
  useEffect(() => {
    const handleScroll = () => {
      if (typeof window === 'undefined') return;

      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const distanceFromBottom = documentHeight - (scrollTop + windowHeight);

      setIsNearBottom(distanceFromBottom < 200);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-open overlay on mount (only once)
  useEffect(() => {
    if (code && !hasInitialized) {
      const timer = setTimeout(() => {
        openOverlay(code, language, title);
        setHasInitialized(true);
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [code, language, title, openOverlay, hasInitialized]);

  // Update overlay content when code/props change (if overlay is already open)
  useEffect(() => {
    if (code && hasInitialized && isOpen) {
      openOverlay(code, language, title);
    }
  }, [code, language, title, openOverlay, hasInitialized, isOpen]);

  // Show floating "View Code" button when overlay is closed
  if (!isOpen) {
    return (
      <button
        onClick={() => openOverlay(code, language, title)}
        className={cn(
          "fixed bottom-6 z-30",
          "flex items-center gap-1.5 px-3 py-2",
          "bg-fd-primary text-fd-primary-foreground",
          "rounded-full shadow-lg",
          "hover:scale-105 active:scale-95",
          "transition-all duration-300",
          "border border-fd-primary/20"
        )}
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
        <Code className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">View Code</span>
      </button>
    );
  }

  return null;
}
