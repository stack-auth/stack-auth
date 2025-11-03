import type { ReactNode } from 'react';

import { MobileAppShell } from '@/components/mobile-app-shell';
import { Navbar } from '@/components/navbar';
import { redirectToProjectIfEmulator } from '@/lib/utils';

export default function Page({ children }: { children?: ReactNode }) {
  redirectToProjectIfEmulator();

  return (
    <MobileAppShell className="mobile-shell-inner--flush">
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <div
          className="px-6"
          style={{ paddingTop: 'clamp(1rem, 4vw, 1.5rem)' }}
        >
          <Navbar title="Projects" subtitle="Workspace" />
        </div>
        <main
          className="flex-1 overflow-y-auto px-6"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
        >
          {children}
        </main>
      </div>
    </MobileAppShell>
  );
}
