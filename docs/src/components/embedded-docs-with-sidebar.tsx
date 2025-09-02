'use client';

import { getCurrentPlatform } from '@/lib/platform-utils';
import type { PageTree } from 'fumadocs-core/server';
import { SidebarProvider } from 'fumadocs-ui/contexts/sidebar';
import { TreeContextProvider } from 'fumadocs-ui/contexts/tree';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AccordionProvider, renderSidebarContent } from './layouts/docs';

type EmbeddedDocsWithSidebarProps = {
  pageTree: PageTree.Root,
  currentSlug: string[],
  children: React.ReactNode,
}

export function EmbeddedDocsWithSidebar({ pageTree, currentSlug, children }: EmbeddedDocsWithSidebarProps) {
  const [isSidebarVisible, setIsSidebarVisible] = useState(false);
  const pathname = usePathname();

  // Get current platform from the pathname - adapt for embedded docs
  const currentPlatform = getCurrentPlatform(pathname.replace('/docs-embed/', '/docs/'));

  // Listen for postMessage from parent widget
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'TOGGLE_SIDEBAR') {
        setIsSidebarVisible(event.data.visible);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <AccordionProvider>
      <SidebarProvider>
        <TreeContextProvider tree={pageTree}>
          <div className="relative h-full">
            {/* Main Content */}
            <div className="h-full overflow-y-auto">
              {children}
            </div>

            {/* Drawer Sidebar Overlay */}
            {isSidebarVisible && (
              <>
                {/* Backdrop */}
                <div
                  className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
                  onClick={() => setIsSidebarVisible(false)}
                />

                {/* Drawer */}
                <div className="fixed left-0 top-0 bottom-0 w-[268px] z-50 bg-fd-background/95 backdrop-blur-md border-r border-fd-border shadow-lg">
                  <div className="h-full flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-fd-border">
                      {currentPlatform && (
                        <div className="text-sm font-medium text-fd-foreground">
                          {currentPlatform === 'next' ? 'Next.js' :
                            currentPlatform === 'js' ? 'JavaScript' :
                            currentPlatform.charAt(0).toUpperCase() + currentPlatform.slice(1)} Documentation
                        </div>
                      )}
                      <button
                        onClick={() => setIsSidebarVisible(false)}
                        className="p-1 rounded-md hover:bg-fd-accent/50 text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                        title="Close sidebar"
                      >
                        ×
                      </button>
                    </div>

                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto">
                      <div className="p-4">
                        {renderSidebarContent(pageTree, pathname.replace('/docs-embed/', '/docs/'))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </TreeContextProvider>
      </SidebarProvider>
    </AccordionProvider>
  );
}
