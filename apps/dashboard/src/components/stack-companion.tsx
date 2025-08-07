'use client';

import { cn } from '@/lib/utils';
import { checkVersion, VersionCheckResult } from '@/lib/version-check';
import { useUser } from '@stackframe/stack';
import { Button } from '@stackframe/stack-ui';
import { BookOpen, HelpCircle, Lightbulb, TimerReset, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import packageJson from '../../package.json';
import { FeedbackForm } from './feedback-form';
import { Logo } from './logo';
import { ChangelogWidget } from './stack-companion/changelog-widget';
import { FeatureRequestBoard } from './stack-companion/feature-request-board';

type StackCompanionProps = {
  className?: string,
  onExpandedChange?: (expanded: boolean) => void,
};

type SidebarItem = {
  id: string,
  label: string,
  icon: React.ElementType,
  color: string,
};

const sidebarItems: SidebarItem[] = [
  {
    id: 'docs',
    label: 'Docs',
    icon: BookOpen,
    color: 'text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300',
  },
  {
    id: 'feedback',
    label: 'Feature Requests',
    icon: Lightbulb,
    color: 'text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300',
  },
  {
    id: 'changelog',
    label: 'Changelog',
    icon: TimerReset,
    color: 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300',
  },
  {
    id: 'support',
    label: "Support",
    icon: HelpCircle,
    color: 'text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300',
  }
];

export function StackCompanion({ className, onExpandedChange }: StackCompanionProps) {
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [versionCheckResult, setVersionCheckResult] = useState<VersionCheckResult>(null);

  // Get current user from Stack Auth
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });

  // Handle hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Version checking logic
  useEffect(() => {
    const cleanup = checkVersion(setVersionCheckResult, {
      delay: 2000, // Give other API requests priority
      silentFailure: true, // Silently fail for the companion
      errorPrefix: "Version check failed in companion"
    });

    return cleanup;
  }, []);

  // Notify parent when expanded state changes
  useEffect(() => {
    onExpandedChange?.(activeItem !== null);
  }, [activeItem, onExpandedChange]);

  // Don't render anything until mounted to avoid hydration issues
  if (!mounted) {
    return null;
  }

  const isExpanded = activeItem !== null;

  return (
    <div className={cn("relative", className)}>
      {/* Single Expanding Sidebar */}
      <div
        className={cn(
          "h-screen bg-background border-l shadow-lg flex transition-all duration-300 ease-in-out",
          isExpanded ? "w-80" : "w-12"
        )}
      >
        {/* Collapsed State - Vertical Buttons */}
        {!isExpanded && (
          <div className="flex flex-col h-full w-12">
            {/* Header - Match navbar height */}
            <div className="flex items-center justify-center h-14 border-b">
              <Logo noLink width={16} height={16} />
            </div>

            {/* Navigation Items */}
            <div className="flex-1 flex flex-col items-center justify-center py-6 space-y-4">
              {sidebarItems.map((item) => {
                const Icon = item.icon;

                return (
                  <div key={item.id} className="relative">
                    <button
                      onClick={() => setActiveItem(String(activeItem) === item.id ? null : item.id)}
                      className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-lg group transition-none hover:bg-muted",
                        item.color
                      )}
                    >
                      <Icon className="h-5 w-5" />

                      {/* Tooltip */}
                      <div className={cn(
                        "absolute right-full top-1/2 -translate-y-1/2 mr-3 px-3 py-2 text-white text-sm font-medium rounded-md shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-[9999] group-active:opacity-0 group-focus:opacity-0 transition-opacity duration-150 group-hover:delay-700 delay-0",
                        item.id === 'docs' ? 'bg-blue-600' :
                          item.id === 'feedback' ? 'bg-purple-600' :
                            item.id === 'changelog' ? 'bg-green-600' :
                              item.id === 'support' ? 'bg-orange-600' : 'bg-gray-900'
                      )}>
                        {item.label}
                        <div className={cn(
                          "absolute left-full top-1/2 -translate-y-1/2 border-4 border-transparent",
                          item.id === 'docs' ? 'border-l-blue-600' :
                            item.id === 'feedback' ? 'border-l-purple-600' :
                              item.id === 'changelog' ? 'border-l-green-600' :
                                item.id === 'support' ? 'border-l-orange-600' : 'border-l-gray-900'
                        )}></div>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Footer - Normal orientation text */}
            <div className={cn(
              "h-12 border-t flex items-center justify-center",
              versionCheckResult ? (versionCheckResult.severe ? "bg-red-500" : "bg-orange-500") : ""
            )}>
              <div className={cn(
                "text-[10px] font-medium text-center",
                versionCheckResult ? "text-white" : "text-muted-foreground"
              )}>
                v{packageJson.version}
              </div>
            </div>
          </div>
        )}

        {/* Expanded State - Full Content */}
        {isExpanded && (
          <div className="flex h-full w-full">
            {/* Left side - Navigation */}
            <div className="flex flex-col h-full w-12 border-r">
              {/* Header - Match navbar height */}
              <div className="flex items-center justify-center h-14 border-b">
                <Logo noLink width={16} height={16} />
              </div>

              {/* Navigation Items */}
              <div className="flex-1 flex flex-col items-center justify-center py-6 space-y-4">
                {sidebarItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeItem === item.id;

                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveItem(String(activeItem) === item.id ? null : item.id)}
                      className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-lg transition-none",
                        isActive ? "bg-gray-200 dark:bg-muted shadow-md" : "hover:bg-muted",
                        item.color
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </button>
                  );
                })}
              </div>

              {/* Footer - Normal orientation text */}
              <div className={cn(
                "h-12 border-t flex items-center justify-center",
                versionCheckResult ? (versionCheckResult.severe ? "bg-red-500" : "bg-orange-500") : ""
              )}>
                <div className={cn(
                  "text-[10px] font-medium text-center",
                  versionCheckResult ? "text-white" : "text-muted-foreground"
                )}>
                  v{packageJson.version}
                </div>
              </div>
            </div>

            {/* Right side - Content */}
            <div className="flex-1 flex flex-col h-full">
              {/* Content Header - Match navbar height */}
              <div className="flex items-center justify-between p-3 h-14 border-b">
                <div className="flex items-center gap-2">
                  {(() => {
                    const item = sidebarItems.find(i => i.id === activeItem);
                    const Icon = item?.icon || BookOpen;
                    return (
                      <>
                        <Icon className={cn("h-4 w-4", item?.color || "text-muted-foreground")} />
                        <h3 className="text-sm font-semibold">{item?.label}</h3>
                      </>
                    );
                  })()}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveItem(null)}
                  className="h-6 w-6 p-0 hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>

              {/* Content Body */}
              <div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>
                <style jsx>{`
                  div::-webkit-scrollbar {
                    display: none;
                  }
                `}</style>
                {activeItem === 'docs' && (
                  <div className="space-y-3">
                    <button
                      onClick={() => window.open('https://docs.stack-auth.com', '_blank')}
                      className="w-full bg-muted/30 hover:bg-muted/50 rounded-lg p-4 text-center transition-colors cursor-pointer group"
                    >
                      <BookOpen className="h-6 w-6 mx-auto mb-2 text-blue-600 group-hover:text-blue-700" />
                      <p className="text-xs text-foreground group-hover:text-blue-600 font-medium">
                        Access Stack Auth Documentation
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Click to open docs.stack-auth.com
                      </p>
                    </button>

                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground italic">
                        Interactive dashboard docs coming soon
                      </p>
                    </div>
                  </div>
                )}

                {activeItem === 'feedback' && (
                  <FeatureRequestBoard isActive={true} />
                )}

                {activeItem === 'changelog' && (
                  <ChangelogWidget isActive={true} />
                )}

                {activeItem === 'support' && (
                  <FeedbackForm />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
