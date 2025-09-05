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
  children: React.ReactNode,
}

export function EmbeddedDocsWithSidebar({ pageTree, children }: EmbeddedDocsWithSidebarProps) {
  const [isSidebarVisible, setIsSidebarVisible] = useState(false);
  const pathname = usePathname();

  // Normalize embedded path to /docs/* once (anchor to start to avoid mid-path replacements)
  const docsPath = pathname.replace(/^\/docs-embed(\/|$)/, '/docs$1');
  const currentPlatform = getCurrentPlatform(docsPath);

  // Listen for postMessage from parent widget
  useEffect(() => {
    const allowedOrigins = process.env.NODE_ENV === 'development' 
      ? ['http://localhost:8101']
      : ['https://app.stack-auth.com'];

    const isAllowedOrigin = (origin: string) => allowedOrigins.includes(origin);

    const handleMessage = (event: MessageEvent) => {
      // Only accept from immediate parent and from allowed origins
      if (event.source !== window.parent) return;
      if (!isAllowedOrigin(event.origin)) return;

      const data = event.data as { type?: unknown; visible?: unknown };
      if (data && typeof data === 'object'
        && (data as any).type === 'TOGGLE_SIDEBAR'
        && typeof (data as any).visible === 'boolean') {
        setIsSidebarVisible((data as any).visible);
      }
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSidebarVisible(false);
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('keydown', handleKeydown);
    };
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
                        {renderSidebarContent(pageTree, docsPath)}
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
