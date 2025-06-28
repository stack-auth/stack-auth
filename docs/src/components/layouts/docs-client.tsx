/**
 * DOCS CLIENT-SIDE COMPONENTS
 *
 * This file contains interactive client-side components that handle sidebar
 * state management and responsive behavior. These components require the
 * 'use client' directive to function properly.
 *
 * USAGE LOCATION:
 * - Only imported and used by docs.tsx (base layout)
 *
 * ARCHITECTURE INTEGRATION:
 * 1. app/docs/layout.tsx
 *    ↓ imports DynamicDocsLayout
 * 2. docs-layout-router.tsx (ROUTER)
 *    ↓ routes to appropriate config → imports DocsLayout
 * 3. docs.tsx (BASE LAYOUT)
 *    ↓ imports and uses THESE CLIENT COMPONENTS
 *
 * COMPONENTS & THEIR RESPONSIBILITIES:
 *
 * 1. Navbar (Mobile Only - md:hidden)
 *    - Sticky header for mobile devices
 *    - Contains title, search, and sidebar trigger
 *    - Automatically handles transparency and backdrop blur
 *
 * 2. NavbarSidebarTrigger (Mobile Only - md:hidden)
 *    - Hamburger menu button to toggle sidebar on mobile
 *    - Integrates with Fumadocs sidebar context
 *
 * 3. CollapsibleControl (Desktop - when sidebar is collapsed)
 *    - Floating control that appears when sidebar is minimized
 *    - Contains sidebar expand button and search toggle
 *    - Positioned via CSS custom properties
 *
 * STATE MANAGEMENT:
 * - All components use Fumadocs context hooks (useSidebar, useNav)
 * - Handle responsive behavior automatically
 * - No local state management needed
 */

'use client';

import { useNav } from 'fumadocs-ui/contexts/layout';
import { useSidebar } from 'fumadocs-ui/contexts/sidebar';
import { Menu, Sidebar as SidebarIcon } from 'lucide-react';
import { type ComponentProps } from 'react';
import { cn } from '../../lib/cn';
import { CompactSearchToggle } from '../layout/custom-search-toggle';
import { SidebarCollapseTrigger } from '../layout/sidebar';
import { buttonVariants } from '../ui/button';

export function Navbar(props: ComponentProps<'header'>) {
  const { open } = useSidebar();
  const { isTransparent } = useNav();

  return (
    <header
      id="nd-subnav"
      {...props}
      className={cn(
        'sticky top-[--fd-banner-height] z-30 flex items-center px-4 border-b transition-colors backdrop-blur-sm',
        (!isTransparent || open) && 'bg-fd-background/80',
        props.className,
      )}
    >
      {props.children}
    </header>
  );
}

export function NavbarSidebarTrigger({
  className,
  ...props
}: ComponentProps<'button'>) {
  const { setOpen } = useSidebar();

  return (
    <button
      {...props}
      aria-label="Open Sidebar"
      className={cn(
        buttonVariants({
          color: 'ghost',
          size: 'icon',
          className,
        }),
      )}
      onClick={() => setOpen((prev) => !prev)}
    >
      <Menu />
    </button>
  );
}

export function CollapsibleControl({ onSearchOpen }: { onSearchOpen?: () => void }) {
  const { collapsed } = useSidebar();
  if (!collapsed) return;

  return (
    <div
      className="fixed flex shadow-lg animate-fd-fade-in rounded-xl p-0.5 border bg-fd-muted text-fd-muted-foreground z-10 xl:start-4 max-xl:end-4"
      style={{
        top: 'calc(var(--fd-banner-height) + var(--fd-tocnav-height) + var(--spacing) * 4)',
      }}
    >
      <SidebarCollapseTrigger
        className={cn(
          buttonVariants({
            color: 'ghost',
            size: 'icon-sm',
            className: 'rounded-lg',
          }),
        )}
      >
        <SidebarIcon />
      </SidebarCollapseTrigger>
      {onSearchOpen && (
        <CompactSearchToggle
          onOpen={onSearchOpen}
          className="rounded-lg w-9 h-9"
        />
      )}
    </div>
  );
}
