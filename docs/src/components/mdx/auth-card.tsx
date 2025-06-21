'use client';

import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type AuthCardProps = {
  /**
   * Card content
   */
  children: ReactNode,

  /**
   * Additional CSS classes to apply to the card
   */
  className?: string,
}

export function AuthCard({
  children,
  className,
}: AuthCardProps) {
  return (
    <div className="flex justify-center w-full">
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border-2 border-blue-500/50 bg-white p-6 shadow-lg',
          'dark:bg-slate-900 dark:border-blue-400/30',
          'max-w-md w-full',
          'backdrop-blur-sm backdrop-filter',
          'ring-4 ring-blue-500/10',
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
