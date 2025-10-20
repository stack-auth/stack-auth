'use client';

import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';
import { useSidebar } from '../sidebar-context';

export function ApiSidebarWrapper({ children }: { children: ReactNode }) {
  const sidebarContext = useSidebar();
  const { isMainSidebarCollapsed } = sidebarContext || {
    isMainSidebarCollapsed: false,
  };

  return (
    <div className={cn(
      "hidden md:block sticky left-0 top-14 lg:top-26 z-30 transition-all duration-300 ease-out",
      isMainSidebarCollapsed ? "w-16" : "w-64"
    )}>
      <div className="h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-6.5rem)] flex flex-col">
        {children}
      </div>
    </div>
  );
}

