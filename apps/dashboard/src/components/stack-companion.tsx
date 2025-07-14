'use client';

import { cn } from '@/lib/utils';
import { Button } from '@stackframe/stack-ui';
import { BookOpen, HelpCircle, Lightbulb, MessageCircle, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';

type StackCompanionProps = {
  className?: string,
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
    color: 'text-blue-500 hover:text-blue-600',
  },
  {
    id: 'help',
    label: 'Help',
    icon: HelpCircle,
    color: 'text-green-500 hover:text-green-600',
  },
  {
    id: 'ideas',
    label: 'Ideas',
    icon: Lightbulb,
    color: 'text-yellow-500 hover:text-yellow-600',
  },
  {
    id: 'feedback',
    label: 'Feedback',
    icon: MessageCircle,
    color: 'text-purple-500 hover:text-purple-600',
  },
  {
    id: 'features',
    label: 'Features',
    icon: Zap,
    color: 'text-orange-500 hover:text-orange-600',
  },
];

export function StackCompanion({ className }: StackCompanionProps) {
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Handle hydration
  useEffect(() => {
    setMounted(true);
  }, []);

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
          "fixed right-0 top-0 h-full bg-background/95 backdrop-blur-md border-l shadow-lg z-20 flex transition-all duration-300 ease-in-out",
          isExpanded ? "w-80" : "w-12"
        )}
      >
        {/* Collapsed State - Vertical Buttons */}
        {!isExpanded && (
          <div className="flex flex-col h-full w-12">
            {/* Header - Match navbar height */}
            <div className="flex items-center justify-center h-14 border-b">
              <Lightbulb className="h-4 w-4 text-primary" />
            </div>

            {/* Navigation Items */}
            <div className="flex-1 flex flex-col items-center py-4 space-y-3">
              {sidebarItems.map((item) => {
                const Icon = item.icon;

                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveItem(item.id)}
                    className="relative group flex flex-col items-center justify-center w-10 h-20 rounded transition-all duration-200 hover:bg-muted/50"
                    title={item.label}
                  >
                    <Icon className={cn("h-4 w-4 transition-colors mb-2", item.color)} />

                    {/* Properly rotated text - rotate 90deg clockwise */}
                    <div
                      className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground transition-colors whitespace-nowrap"
                      style={{
                        transform: 'rotate(90deg)',
                        transformOrigin: 'center',
                        width: '50px',
                        height: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      {item.label}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Footer - Normal orientation text */}
            <div className="h-12 border-t flex items-center justify-center">
              <div className="text-[10px] text-muted-foreground font-medium">
                v1.0
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
                <Lightbulb className="h-4 w-4 text-primary" />
              </div>

              {/* Navigation Items */}
              <div className="flex-1 flex flex-col items-center py-4 space-y-3">
                {sidebarItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeItem === item.id;

                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveItem(item.id)}
                      className={cn(
                        "relative group flex flex-col items-center justify-center w-10 h-20 rounded transition-all duration-200 hover:bg-muted/50",
                        isActive && "bg-muted"
                      )}
                      title={item.label}
                    >
                      <Icon className={cn("h-4 w-4 transition-colors mb-2", item.color)} />

                      {/* Properly rotated text - rotate 90deg clockwise */}
                      <div
                        className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground transition-colors whitespace-nowrap"
                        style={{
                          transform: 'rotate(90deg)',
                          transformOrigin: 'center',
                          width: '50px',
                          height: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        {item.label}
                      </div>

                      {/* Active Indicator */}
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-12 bg-primary rounded-r" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Footer - Normal orientation text */}
              <div className="h-12 border-t flex items-center justify-center">
                <div className="text-[10px] text-muted-foreground font-medium">
                  v1.0
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
                        <Icon className={cn("h-4 w-4", item?.color)} />
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
              <div className="flex-1 overflow-y-auto p-3">
                {activeItem === 'docs' && (
                  <div className="space-y-3">
                    <div className="bg-muted/30 rounded-lg p-4 text-center">
                      <BookOpen className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">
                        This is a test example of docs
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Interactive documentation coming soon!
                      </p>
                    </div>
                  </div>
                )}

                {activeItem === 'help' && (
                  <div className="space-y-3">
                    <div className="bg-muted/30 rounded-lg p-4 text-center">
                      <HelpCircle className="h-6 w-6 mx-auto mb-2 text-green-500" />
                      <p className="text-xs text-muted-foreground mb-3">
                        Get help with Stack Auth
                      </p>
                      <div className="space-y-1">
                        <Button variant="outline" size="sm" className="w-full h-7 text-xs">
                          View FAQ
                        </Button>
                        <Button variant="outline" size="sm" className="w-full h-7 text-xs">
                          Contact Support
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {activeItem === 'ideas' && (
                  <div className="space-y-3">
                    <div className="bg-muted/30 rounded-lg p-4 text-center">
                      <Lightbulb className="h-6 w-6 mx-auto mb-2 text-yellow-500" />
                      <p className="text-xs text-muted-foreground mb-3">
                        Share your ideas for Stack Auth
                      </p>
                      <Button variant="outline" size="sm" className="w-full h-7 text-xs">
                        Submit Idea
                      </Button>
                    </div>
                  </div>
                )}

                {activeItem === 'feedback' && (
                  <div className="space-y-3">
                    <div className="bg-muted/30 rounded-lg p-4 text-center">
                      <MessageCircle className="h-6 w-6 mx-auto mb-2 text-purple-500" />
                      <p className="text-xs text-muted-foreground mb-3">
                        Tell us what you think
                      </p>
                      <Button variant="outline" size="sm" className="w-full h-7 text-xs">
                        Send Feedback
                      </Button>
                    </div>
                  </div>
                )}

                {activeItem === 'features' && (
                  <div className="space-y-3">
                    <div className="bg-muted/30 rounded-lg p-4 text-center">
                      <Zap className="h-6 w-6 mx-auto mb-2 text-orange-500" />
                      <p className="text-xs text-muted-foreground mb-3">
                        Request new features
                      </p>
                      <Button variant="outline" size="sm" className="w-full h-7 text-xs">
                        Feature Requests
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Overlay */}
      {isExpanded && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-10 md:hidden"
          onClick={() => setActiveItem(null)}
        />
      )}
    </div>
  );
}
