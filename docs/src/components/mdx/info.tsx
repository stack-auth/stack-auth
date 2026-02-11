'use client';

import React from 'react';
import { cn } from '../../lib/cn';

export type InfoProps = {
  children: React.ReactNode,
  type?: 'info' | 'warning' | 'success' | 'danger',
  size?: 'default' | 'small',
}

export function Info({ children, type = 'info', size = 'default' }: InfoProps) {
  const colorVariants = {
    info: {
      accent: 'bg-gradient-to-b from-blue-400 to-blue-600',
      bg: 'bg-gradient-to-r from-blue-50/80 to-transparent dark:from-blue-950/30 dark:to-transparent',
      icon: 'text-blue-500 dark:text-blue-400',
      title: 'text-blue-800 dark:text-blue-200'
    },
    warning: {
      accent: 'bg-gradient-to-b from-amber-400 to-amber-600',
      bg: 'bg-gradient-to-r from-amber-50/80 to-transparent dark:from-amber-950/30 dark:to-transparent',
      icon: 'text-amber-500 dark:text-amber-400',
      title: 'text-amber-800 dark:text-amber-200'
    },
    success: {
      accent: 'bg-gradient-to-b from-emerald-400 to-emerald-600',
      bg: 'bg-gradient-to-r from-emerald-50/80 to-transparent dark:from-emerald-950/30 dark:to-transparent',
      icon: 'text-emerald-500 dark:text-emerald-400',
      title: 'text-emerald-800 dark:text-emerald-200'
    },
    danger: {
      accent: 'bg-gradient-to-b from-red-500 to-red-700',
      bg: 'bg-gradient-to-r from-red-50/90 to-transparent dark:from-red-950/40 dark:to-transparent',
      icon: 'text-red-600 dark:text-red-400',
      title: 'text-red-900 dark:text-red-200'
    }
  };

  const colors = colorVariants[type];

  const sizeVariants = {
    default: {
      container: 'my-6',
      content: 'py-1 px-2',
      icon: 'w-5 h-5 mr-3',
    },
    small: {
      container: 'my-4',
      content: 'py-0.5 px-1.5',
      icon: 'w-4 h-4 mr-2',
    }
  };

  const sizes = sizeVariants[size];

  return (
    <div className={cn(
      'relative overflow-hidden rounded-lg',
      sizes.container,
      colors.bg
    )}>
      {/* Left accent bar */}
      <div className={cn(
        'absolute left-0 top-0 bottom-0 w-1 rounded-l-lg',
        colors.accent
      )} />
      <div className={cn("flex items-baseline", sizes.content)}>
        <div className={cn("flex-shrink-0", colors.icon)}>
          {type === 'info' && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={sizes.icon}>
              <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 01.67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 11-.671-1.34l.041-.022zM12 9a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
            </svg>
          )}
          {type === 'warning' && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={sizes.icon}>
              <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
            </svg>
          )}
          {type === 'success' && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={sizes.icon}>
              <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
            </svg>
          )}
          {type === 'danger' && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={sizes.icon}>
              <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
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
