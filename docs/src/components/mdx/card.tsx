'use client';

import { Code, FileText, Play, Puzzle } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

// Icon mapping for common FontAwesome classes to Lucide components
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  'fa-regular fa-play': Play,
  'fa-solid fa-puzzle': Puzzle,
  'fa-regular fa-file-lines': FileText,
  'fa-solid fa-code': Code,
};

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
   * Optional title for the card
   */
  title?: string,

  /**
   * Optional FontAwesome icon class (e.g., "fa-solid fa-code") - mapped to Lucide icons
   */
  icon?: string,

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
  title,
  icon,
  className,
  hover = true,
}: CardProps) {
  // Get the Lucide icon component from the mapping
  const IconComponent = icon ? iconMap[icon] : null;

  const cardContent = (
    <div
      className={cn(
        'fern-card relative overflow-hidden rounded-xl border border-fd-border/50 bg-fd-card p-6 shadow-sm h-full',
        hover && 'transition-all duration-200 hover:shadow-md hover:border-fd-border/80 hover:-translate-y-0.5',
        className
      )}
    >
      <div className="flex flex-col gap-2 h-full">
        {IconComponent && (
          <div className="w-12 h-12 rounded-xl bg-fd-primary/10 flex items-center justify-center flex-shrink-0">
            <IconComponent className="w-6 h-6 text-fd-primary" />
          </div>
        )}
        {title && (
          <div className="font-semibold text-fd-foreground text-xl leading-tight">
            {title}
          </div>
        )}
        {children && (
          <div className="text-fd-muted-foreground text-sm leading-relaxed flex-1">
            {children}
          </div>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block no-underline h-full">
        {cardContent}
      </Link>
    );
  }

  return cardContent;
}
