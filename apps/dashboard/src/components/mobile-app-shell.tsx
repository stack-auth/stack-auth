'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type MobileAppShellProps = {
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
};

export function MobileAppShell({ children, className, footer }: MobileAppShellProps) {
  return (
    <div className="mobile-shell-outer">
      <div className={cn('mobile-shell-inner', className)}>
        <div aria-hidden className="mobile-shell-background" />
        <div className="mobile-shell-content">
          {children}
        </div>
        {footer ? (
          <div className="mobile-shell-footer">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
