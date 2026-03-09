'use client';

import { type ReactNode } from 'react';

export function ApiLayoutWrapper({ children }: { children: ReactNode }) {
  return (
    <div className="w-full">
      {children}
    </div>
  );
}
