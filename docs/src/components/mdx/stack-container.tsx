'use client';

import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type StackContainerProps = {
  /**
   * Title for the container
   */
  title?: string,

  /**
   * Container content
   */
  children: ReactNode,

  /**
   * Color theme for the container (default: blue)
   */
  color?: 'blue' | 'purple' | 'green' | 'amber',

  /**
   * Size variant for the container (default: medium)
   */
  size?: 'small' | 'medium' | 'large' | 'xlarge' | 'full',

  /**
   * Additional CSS classes to apply to the container
   */
  className?: string,
}

export function StackContainer({
  title,
  children,
  color = 'blue',
  size = 'medium',
  className,
}: StackContainerProps) {
  // Define color variants
  const colorVariants = {
    blue: {
      border: 'border-blue-500/40 dark:border-blue-400/20',
      title: 'text-blue-700 dark:text-blue-400',
      label: 'text-blue-600/80 dark:text-blue-400/70'
    },
    purple: {
      border: 'border-purple-500/40 dark:border-purple-400/20',
      title: 'text-purple-700 dark:text-purple-400',
      label: 'text-purple-600/80 dark:text-purple-400/70'
    },
    green: {
      border: 'border-emerald-500/40 dark:border-emerald-400/20',
      title: 'text-emerald-700 dark:text-emerald-400',
      label: 'text-emerald-600/80 dark:text-emerald-400/70'
    },
    amber: {
      border: 'border-amber-600/40 dark:border-amber-400/20',
      title: 'text-amber-800 dark:text-amber-500',
      label: 'text-amber-700/80 dark:text-amber-400/70'
    }
  };

  // Define size variants
  const sizeVariants = {
    small: 'max-w-xs',
    medium: 'max-w-md',
    large: 'max-w-2xl',
    xlarge: 'max-w-4xl',
    full: 'max-w-full'
  };

  const colors = colorVariants[color];
  const sizeClass = sizeVariants[size];

  return (
    <div className="flex justify-center w-full my-8">
      <div
        className={cn(
          'relative overflow-hidden rounded-lg border border-dashed',
          'bg-gray-200/90 dark:bg-slate-900/30',
          'border-gray-700/80 dark:border-gray-600/40',
          'w-full',
          'shadow-sm',
          colors.border,
          sizeClass,
          className
        )}
      >
        {/* Component demo label */}
        <div className="absolute top-0 right-0 px-2 py-1 text-xs font-medium rounded-bl-md bg-gray-200/90 dark:bg-slate-800/80 border-l border-b border-gray-400/60 dark:border-gray-600/40">
          <span className={colors.label}>Component Demo</span>
        </div>

        <div className="p-8 flex justify-center">
          {title && (
            <h3 className={cn("text-sm font-medium mb-3", colors.title)}>
              {title}
            </h3>
          )}

          {/* Content area with subtle background */}
          <div className="flex justify-center w-full">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
