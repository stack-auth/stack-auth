'use client';

import { cn } from '@/lib/utils';
import { checkVersion, VersionCheckResult } from '@/lib/version-check';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@stackframe/stack-ui';
import { BookOpen, HelpCircle, Lightbulb, TimerReset, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import packageJson from '../../package.json';
import { FeedbackForm } from './feedback-form';
import { ChangelogWidget } from './stack-companion/changelog-widget';
import { FeatureRequestBoard } from './stack-companion/feature-request-board';
import { UnifiedDocsWidget } from './stack-companion/unified-docs-widget';

type SidebarItem = {
  id: string,
  label: string,
  icon: React.ElementType,
  color: string,
  hoverBg: string,
};

const sidebarItems: SidebarItem[] = [
  {
    id: 'docs',
    label: 'Docs',
    icon: BookOpen,
    color: 'text-blue-600 dark:text-blue-400',
    hoverBg: 'hover:bg-blue-500/10',
  },
  {
    id: 'feedback',
    label: 'Feature Requests',
    icon: Lightbulb,
    color: 'text-purple-600 dark:text-purple-400',
    hoverBg: 'hover:bg-purple-500/10',
  },
  {
    id: 'changelog',
    label: 'Changelog',
    icon: TimerReset,
    color: 'text-green-600 dark:text-green-400',
    hoverBg: 'hover:bg-green-500/10',
  },
  {
    id: 'support',
    label: "Support",
    icon: HelpCircle,
    color: 'text-orange-600 dark:text-orange-400',
    hoverBg: 'hover:bg-orange-500/10',
  }
];

const MIN_DRAWER_WIDTH = 400;
const MAX_DRAWER_WIDTH = 800;
const DEFAULT_DRAWER_WIDTH = 480;
const CLOSE_THRESHOLD = 100;

export function StackCompanion({ className }: { className?: string }) {
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [versionCheckResult, setVersionCheckResult] = useState<VersionCheckResult>(null);
  const [drawerWidth, setDrawerWidth] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const dragThresholdRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const cleanup = checkVersion(setVersionCheckResult, {
      delay: 2000,
      silentFailure: true,
      errorPrefix: "Version check failed in companion"
    });
    return cleanup;
  }, []);

  const openDrawer = useCallback((itemId: string) => {
    setActiveItem(itemId);
    setIsAnimating(true);
    // Start animation
    requestAnimationFrame(() => {
      setDrawerWidth(DEFAULT_DRAWER_WIDTH);
      setTimeout(() => setIsAnimating(false), 300);
    });
  }, []);

  const closeDrawer = useCallback(() => {
    setIsAnimating(true);
    setDrawerWidth(0);
    setTimeout(() => {
      setActiveItem(null);
      setIsAnimating(false);
    }, 300);
  }, []);

  // Handle click vs drag
  const handleItemClick = useCallback((itemId: string) => {
    if (dragThresholdRef.current) return; // Ignore clicks if we were dragging
    
    if (activeItem === itemId) {
      closeDrawer();
    } else if (activeItem) {
      setActiveItem(itemId);
    } else {
      openDrawer(itemId);
    }
  }, [activeItem, closeDrawer, openDrawer]);

  const handleMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    // Don't initiate drag if clicking resizing handle or scrollbar
    if ((e.target as HTMLElement).closest('.no-drag')) return;
    
    // Only allow dragging when an item is already selected (drawer is open)
    if (!activeItem) return;

    setIsResizing(true);
    setIsAnimating(false);
    dragThresholdRef.current = false;
    
    startXRef.current = 'touches' in e ? e.touches[0].clientX : e.clientX;
    startWidthRef.current = drawerWidth;
  }, [drawerWidth, activeItem]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const deltaX = startXRef.current - clientX;
      
      // Check for drag threshold to distinguish click vs drag
      if (Math.abs(deltaX) > 5) {
        dragThresholdRef.current = true;
        setIsDragging(true);
      }

      // Logic:
      // - Moving left (positive deltaX) -> Width increases
      // - Moving right (negative deltaX) -> Width decreases
      // But only if we are starting from right edge.
      // Since flex-row-reverse anchors to right, increasing width moves the handle left.
      
      let newWidth = startWidthRef.current + deltaX;
      newWidth = Math.max(0, Math.min(MAX_DRAWER_WIDTH, newWidth));
      
      setDrawerWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setTimeout(() => setIsDragging(false), 0);

      if (dragThresholdRef.current) {
        // If we dragged, snap to state
        if (drawerWidth < CLOSE_THRESHOLD) {
          closeDrawer();
        } else if (drawerWidth < MIN_DRAWER_WIDTH) {
          setIsAnimating(true);
          setDrawerWidth(MIN_DRAWER_WIDTH);
          setTimeout(() => setIsAnimating(false), 200);
        } else {
          // Keep current width but ensure item is active
          if (!activeItem) {
             // If dragged open from closed state without clicking specific item, default to docs
             setActiveItem('docs'); 
          }
        }
      } else {
        // If it was just a click (no drag), handleItemClick will trigger
      }
      dragThresholdRef.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleMouseMove, { passive: false });
    document.addEventListener('touchend', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleMouseMove);
      document.removeEventListener('touchend', handleMouseUp);
    };
  }, [isResizing, drawerWidth, closeDrawer, activeItem]);

  // Disable text selection during drag
  useEffect(() => {
    if (isDragging) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isDragging]);

  if (!mounted) return null;

  const isOpen = drawerWidth > 0;
  const currentItem = sidebarItems.find(i => i.id === activeItem);
  const showContent = drawerWidth >= CLOSE_THRESHOLD;
  
  // Calculate content opacity for smooth fade-out as width approaches close threshold
  const contentOpacity = Math.min(1, Math.max(0, (drawerWidth - CLOSE_THRESHOLD) / (MIN_DRAWER_WIDTH - CLOSE_THRESHOLD)));

  return (
    <>
      {/* Backdrop - transparent but blocks interaction with content if dragging? 
          User asked for "work along side it", so NO backdrop pointer-events.
          We only use it for closing on outside click if we really wanted, but requested behavior implies modeless.
      */}
      
      {/* Main Container - Fixed Right Edge, Flex Reverse to push handle left */}
      <div className="fixed inset-y-0 right-0 z-50 flex flex-row-reverse items-center pointer-events-none">
        
        {/* 1. Drawer Content (Rightmost in layout, stays anchored to right) */}
        <div
          className={cn(
            "h-full bg-background/80 backdrop-blur-xl border-l border-foreground/[0.08] shadow-2xl overflow-hidden pointer-events-auto relative",
            isAnimating && !isResizing && "transition-[width] duration-300 ease-out"
          )}
          style={{ width: drawerWidth }}
        >
          {/* Inner shadow/gradient for depth */}
          <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-foreground/10 to-transparent opacity-50" />

          {isOpen && activeItem && (
            <div 
              className="flex flex-col h-full w-full min-w-[360px] transition-opacity duration-150"
              style={{ opacity: contentOpacity }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-foreground/[0.06] shrink-0 bg-background/40">
                <div className="flex items-center gap-2.5">
                  {currentItem && (
                    <>
                      <div className={cn("p-1.5 rounded-lg bg-foreground/[0.04]")}>
                        <currentItem.icon className={cn("h-4 w-4", currentItem.color)} />
                      </div>
                      <span className="font-semibold text-foreground">
                        {currentItem.label}
                      </span>
                    </>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] rounded-lg no-drag"
                  onClick={closeDrawer}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-5 overflow-x-hidden no-drag cursor-auto">
                {activeItem === 'docs' && <UnifiedDocsWidget isActive={true} />}
                {activeItem === 'feedback' && <FeatureRequestBoard isActive={true} />}
                {activeItem === 'changelog' && <ChangelogWidget isActive={true} />}
                {activeItem === 'support' && <FeedbackForm />}
              </div>
            </div>
          )}
        </div>

        {/* 2. Stack Companion Handle (Left of Drawer) */}
        <div 
          className="h-full flex items-center shrink-0 pointer-events-auto -mr-px z-10"
          onMouseDown={handleMouseDown}
          onTouchStart={handleMouseDown}
        >
          {/* The Handle Pill */}
          <div className={cn(
            "flex flex-col items-center gap-3 px-2 py-3 bg-foreground/5 backdrop-blur-xl border border-foreground/5 shadow-sm transition-all duration-300 select-none",
            // Only show grab cursor when an item is selected (drawer can be resized)
            activeItem && "cursor-grab active:cursor-grabbing",
            // Shape morphing
            isOpen ? "rounded-l-2xl rounded-r-none border-r-0 translate-x-px" : "rounded-full mr-3",
            className
          )}>
            {/* Grip Indicator Removed here */}

            {sidebarItems.map(item => (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-10 w-10 p-0 text-muted-foreground transition-all duration-[50ms] rounded-xl relative group",
                      item.hoverBg,
                      activeItem === item.id && "bg-foreground/10 text-foreground shadow-sm ring-1 ring-foreground/5"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleItemClick(item.id);
                    }}
                    // Pass mouse down to parent for drag
                  >
                    <item.icon className={cn("h-5 w-5 transition-transform duration-[50ms] group-hover:scale-110", item.color)} />
                    {/* Active indicator removed here */}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" className="z-[60] mr-2">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            ))}
            
            {versionCheckResult && (
              <div className={cn(
                "mt-auto pt-2 px-2 py-1 text-[10px] rounded-full font-mono font-medium opacity-60 hover:opacity-100 transition-opacity",
                versionCheckResult.severe ? "text-red-500" : "text-orange-500"
              )}>
                v{packageJson.version}
              </div>
            )}
          </div>
        </div>

      </div>
    </>
  );
}
