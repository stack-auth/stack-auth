'use client';

import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useSidebar } from './sidebar-context';

type SharedContentLayoutVariant = 'default' | 'wide' | 'full';

export type SharedContentLayoutProps = {
  children: ReactNode,
  className?: string,
  variant?: SharedContentLayoutVariant,
} & HTMLAttributes<HTMLElement>

/**
 * Shared content layout component used by both API and docs pages
 * to ensure consistent styling and structure across all documentation.
 */
export function SharedContentLayout({
  children,
  className,
  variant = 'default',
  ...props
}: SharedContentLayoutProps) {
  const { isMainSidebarCollapsed = false } = useSidebar() ?? {};

  const resolvedMaxWidth = (() => {
    if (variant === 'full') {
      return 'max-w-full';
    }
    if (variant === 'wide') {
      return isMainSidebarCollapsed ? 'max-w-full' : 'max-w-7xl';
    }
    return isMainSidebarCollapsed ? 'max-w-full' : 'max-w-6xl';
  })();

  const baseContainerClasses = 'container mx-auto px-4 md:px-6 py-8 w-full min-w-0 transition-all duration-300';

  return (
    <article
      {...props}
      className={cn(
        'flex w-full flex-1 flex-col min-w-0',
        className,
      )}
    >
      <div className={cn(baseContainerClasses, resolvedMaxWidth)}>
        {children}
      </div>
    </article>
  );
}
