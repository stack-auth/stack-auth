import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type SharedContentLayoutProps = {
  children: ReactNode,
  className?: string,
} & HTMLAttributes<HTMLElement>

/**
 * Shared content layout component used by both API and docs pages
 * to ensure consistent styling and structure across all documentation.
 */
export function SharedContentLayout({
  children,
  className,
  ...props
}: SharedContentLayoutProps) {
  return (
    <article
      {...props}
      className={cn(
        'flex w-full flex-1 flex-col min-w-0',
        className,
      )}
    >
      <div className="container max-w-6xl mx-auto px-4 md:px-6 py-8 w-full min-w-0">
        {children}
      </div>
    </article>
  );
}
