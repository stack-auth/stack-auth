'use client';

import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface StackContainerProps {
  /**
   * Title for the container
   */
  title?: string;
  
  /**
   * Container content
   */
  children: ReactNode;
  
  /**
   * Color theme for the container (default: blue)
   */
  color?: 'blue' | 'purple' | 'green' | 'amber';
  
  /**
   * Additional CSS classes to apply to the container
   */
  className?: string;
}

export function StackContainer({
  title,
  children,
  color = 'blue',
  className,
}: StackContainerProps) {
  // Define color variants
  const colorVariants = {
    blue: {
      border: 'border-blue-400/30 dark:border-blue-400/20',
      title: 'text-blue-600 dark:text-blue-400',
      label: 'text-blue-500/70 dark:text-blue-400/70'
    },
    purple: {
      border: 'border-purple-400/30 dark:border-purple-400/20',
      title: 'text-purple-600 dark:text-purple-400',
      label: 'text-purple-500/70 dark:text-purple-400/70'
    },
    green: {
      border: 'border-emerald-400/30 dark:border-emerald-400/20',
      title: 'text-emerald-600 dark:text-emerald-400',
      label: 'text-emerald-500/70 dark:text-emerald-400/70'
    },
    amber: {
      border: 'border-amber-400/30 dark:border-amber-400/20',
      title: 'text-amber-600 dark:text-amber-500',
      label: 'text-amber-500/70 dark:text-amber-400/70'
    }
  };
  
  const colors = colorVariants[color];
  
  return (
    <div className="flex justify-center w-full my-8">
      <div 
        className={cn(
          'relative overflow-hidden rounded-lg border border-dashed',
          'bg-gray-50/50 dark:bg-slate-900/30',
          'max-w-md w-full',
          'shadow-sm',
          colors.border,
          className
        )}
      >
        {/* Component demo label */}
        <div className="absolute top-0 right-0 px-2 py-1 text-xs font-medium rounded-bl-md bg-gray-100/80 dark:bg-slate-800/80">
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
