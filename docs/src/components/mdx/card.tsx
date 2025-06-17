'use client';

import Link from 'next/link';
import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type CardProps = {
  /**
   * Optional URL for the card to link to
   */
  href?: string,

  /**
   * Card content
   */
  children: ReactNode,

  /**
   * Additional CSS classes to apply to the card
   */
  className?: string,

  /**
   * Apply hover effects (default: true)
   */
  hover?: boolean,
}

export function Card({
  href,
  children,
  className,
  hover = true,
}: CardProps) {
  const cardContent = (
    <div
      className={cn(
        'fern-card relative overflow-hidden rounded-xl border border-fd-border/50 bg-fd-card p-5 shadow-sm',
        hover && 'transition-all duration-200 hover:shadow-md hover:border-fd-border/80 hover:-translate-y-0.5',
        className
      )}
    >
      <div className="flex flex-col gap-3">
        {children}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block no-underline">
        {cardContent}
      </Link>
    );
  }

  return cardContent;
}
