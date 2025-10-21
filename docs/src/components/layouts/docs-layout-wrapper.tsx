'use client';

import { cn } from '@/lib/cn';
import { type ReactNode } from 'react';
import { useSidebar } from './sidebar-context';

export function DocsLayoutWrapper({ children }: { children: ReactNode }) {
  const sidebarContext = useSidebar();
  const isCollapsed = sidebarContext?.isMainSidebarCollapsed ?? false;

  return (
    <div className={cn(
      "w-full mx-auto transition-all duration-300",
      isCollapsed ? "max-w-full" : "max-w-screen-xl"
    )}>
      {children}
    </div>
  );
}

