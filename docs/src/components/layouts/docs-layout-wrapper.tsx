'use client';

import { type ReactNode } from 'react';

export function DocsLayoutWrapper({ children }: { children: ReactNode }) {
  return (
    <div className="w-full">
      {children}
    </div>
  );
}
