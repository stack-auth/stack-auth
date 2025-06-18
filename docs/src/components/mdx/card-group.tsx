'use client';

import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type CardGroupProps = {
  /**
   * Card components to display in the grid
   */
  children: ReactNode,

  /**
   * Additional CSS classes to apply to the card group
   */
  className?: string,

  /**
   * Number of columns on larger screens (default: 2)
   */
  cols?: 1 | 2 | 3 | 4,
}

export function CardGroup({
  children,
  className,
  cols = 2,
}: CardGroupProps) {
  const columns = {
    1: 'md:grid-cols-1',
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-4',
  }[cols];

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 mb-8 items-stretch',
        columns,
        className
      )}
    >
      {children}
    </div>
  );
}
