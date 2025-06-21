'use client';

import React from 'react';
import { cn } from '../../lib/cn';

export type InfoProps = {
  children: React.ReactNode,
  type?: 'info' | 'warning' | 'success',
}

export function Info({ children, type = 'info' }: InfoProps) {
  const colorVariants = {
    info: {
      border: 'border-blue-400/30 dark:border-blue-400/20',
      bg: 'bg-blue-50/50 dark:bg-blue-900/10',
      icon: 'text-blue-500 dark:text-blue-400',
      title: 'text-blue-700 dark:text-blue-300'
    },
    warning: {
      border: 'border-amber-400/30 dark:border-amber-400/20',
      bg: 'bg-amber-50/50 dark:bg-amber-900/10',
      icon: 'text-amber-500 dark:text-amber-400',
      title: 'text-amber-700 dark:text-amber-300'
    },
    success: {
      border: 'border-emerald-400/30 dark:border-emerald-400/20',
      bg: 'bg-emerald-50/50 dark:bg-emerald-900/10',
      icon: 'text-emerald-500 dark:text-emerald-400',
      title: 'text-emerald-700 dark:text-emerald-300'
    }
  };

  const colors = colorVariants[type];

  return (
    <div className={cn(
      'relative my-6 overflow-hidden rounded-lg',
      'border border-dashed',
      'shadow-sm',
      colors.border,
      colors.bg
    )}>
      <div className="flex items-baseline py-1 px-2">
        <div className={cn("flex-shrink-0 mr-3", colors.icon)}>
          {type === 'info' && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 01.67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 11-.671-1.34l.041-.022zM12 9a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
            </svg>
          )}
          {type === 'warning' && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
            </svg>
          )}
          {type === 'success' && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
            </svg>
          )}
        </div>
        <div className={cn("flex-1", colors.title)}>
          {children}
        </div>
      </div>
    </div>
  );
}
