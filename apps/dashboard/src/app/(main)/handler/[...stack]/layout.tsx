import type { ReactNode } from 'react';
import { MobileAppShell } from '@/components/mobile-app-shell';
import { Navbar } from '@/components/navbar';

export default function Page({ children }: { children?: ReactNode }) {
  return (
    <MobileAppShell className="mobile-shell-inner--flush">
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="px-6"
          style={{ paddingTop: 'clamp(1rem, 4vw, 1.5rem)' }}
        >
          <Navbar title="Handler" />
        </div>
        <main
          className="flex-1 overflow-y-auto px-6"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.75rem)' }}
        >
          {children}
        </main>
      </div>
    </MobileAppShell>
  );
}
