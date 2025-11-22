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

export type QuickLinkProps = {
  /**
   * URL for the quick link
   */
  href: string,

  /**
   * Title for the quick link
   */
  title: string,

  /**
   * Optional description
   */
  children?: ReactNode,

  /**
   * Optional FontAwesome icon class (e.g., "fa-solid fa-code") - mapped to Lucide icons
   */
  icon?: string,

  /**
   * Gradient index - not used in current design
   */
  gradient?: number,
}

export function QuickLink({
  href,
  title,
  children,
  icon,
}: QuickLinkProps) {
  const IconComponent = icon ? iconMap[icon] : null;

  return (
    <Link
      href={href}
      className={cn(
        "group relative block no-underline h-full overflow-hidden",
        "rounded-xl border-2 border-fd-border/50 bg-fd-card/50 backdrop-blur-sm",
        "transition-all duration-150",
        "hover:border-fd-foreground/20 hover:bg-fd-card/80"
      )}
    >
      <div className="relative p-5 flex items-start gap-4">
        {/* Icon with floating effect */}
        {IconComponent && (
          <div className="relative">
            <div className={cn(
              'relative w-12 h-12 rounded-xl flex items-center justify-center',
              'border border-fd-border/50',
              'bg-fd-muted/30',
              'transition-all duration-150',
              'group-hover:scale-110 group-hover:border-fd-primary/30'
            )}>
              <IconComponent className="w-6 h-6 text-fd-foreground transition-colors duration-150 group-hover:text-fd-primary" />
            </div>
          </div>
        )}

        {/* Text content */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-fd-foreground text-base leading-tight mb-1.5 transition-colors duration-150 group-hover:text-fd-primary">
            {title}
          </div>
          {children && (
            <div className="text-fd-muted-foreground text-sm leading-tight">
              {children}
            </div>
          )}
        </div>

        {/* Arrow with slide effect */}
        <div className={cn(
          "absolute bottom-4 right-4 transition-all duration-150",
          "opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0",
          "text-fd-primary"
        )}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </div>
      </div>
    </Link>
  );
}

export type QuickLinksProps = {
  /**
   * QuickLink components to display
   */
  children: ReactNode,

  /**
   * Additional CSS classes
   */
  className?: string,
}

export function QuickLinks({
  children,
  className,
}: QuickLinksProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 md:grid-cols-2 auto-rows-fr gap-4 my-8 not-prose items-stretch max-w-3xl mx-auto',
        className
      )}
    >
      {children}
    </div>
  );
}
