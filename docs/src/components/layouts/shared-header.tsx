'use client';
import { CustomSearchDialog } from '@/components/layout/custom-search-dialog';
import { SearchInputToggle } from '@/components/layout/custom-search-toggle';
import { docsConfig } from '@/docs-config';
import { UserButton, useUser } from '@stackframe/stack';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Key, Menu, Sidebar as SidebarIcon, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { useSidebar } from './sidebar-context';

type SharedHeaderProps = {
  /** Whether to show the search bar */
  showSearch?: boolean,
  /** Additional content to render after nav links */
  children?: ReactNode,
  /** Mobile menu click handler */
  onMobileMenuClick?: () => void,
  /** Sidebar content to show in mobile navigation */
  sidebarContent?: ReactNode,
}

/**
 * Helper functions to detect which section we're in
 */
export function isInSdkSection(pathname: string): boolean {
  return pathname === '/docs/sdk' || pathname.startsWith('/docs/sdk/');
}

export function isInComponentsSection(pathname: string): boolean {
  return pathname === '/docs/components' || pathname.startsWith('/docs/components/');
}

export function isInApiSection(pathname: string): boolean {
  return pathname.startsWith('/api');
}

/**
 * Zen Toggle Button - Collapses sidebar and hides TOC
 */
function ZenToggleButton(props: { className?: string }) {
  const sidebarContext = useSidebar();

  if (!sidebarContext) return null;

  const { isMainSidebarCollapsed, toggleMainSidebar, isTocOpen, setTocOpen } = sidebarContext;

  const handleClick = () => {
    const enteringZen = !isMainSidebarCollapsed;
    toggleMainSidebar();
    if (enteringZen) {
      setTocOpen(false);
    } else {
      setTocOpen(true);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-full text-fd-muted-foreground transition-colors hover:bg-fd-muted hover:text-fd-foreground',
        props.className
      )}
      title={isMainSidebarCollapsed ? 'Exit zen mode' : 'Zen mode'}
    >
      <SidebarIcon className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * Auth Toggle Button - Only shows on API pages
 */
function AuthToggleButton(props: { className: string }) {
  const pathname = usePathname();
  const sidebarContext = useSidebar();

  const isAPIPage = isInApiSection(pathname);

  if (!isAPIPage) return null;

  if (!sidebarContext) {
    return null;
  }

  const { isAuthOpen, toggleAuth } = sidebarContext;

  return (
    <button
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors',
        isAuthOpen
          ? 'bg-fd-primary/10 text-fd-primary hover:bg-fd-primary/20'
          : 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50',
        props.className
      )}
      onClick={toggleAuth}
    >
      <Key className="h-3 w-3" />
      <span className="font-medium">Auth</span>
    </button>
  );
}

// Stack Auth Logo Component
function StackAuthLogo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-fd-foreground hover:text-fd-foreground/80 transition-colors">
      <svg
        width="30"
        height="24"
        viewBox="0 0 200 242"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Stack Logo"
        className="flex-shrink-0"
      >
        <path d="M103.504 1.81227C101.251 0.68679 98.6002 0.687576 96.3483 1.81439L4.4201 47.8136C1.71103 49.1692 0 51.9387 0 54.968V130.55C0 133.581 1.7123 136.351 4.42292 137.706L96.4204 183.695C98.6725 184.82 101.323 184.82 103.575 183.694L168.422 151.271C173.742 148.611 180 152.479 180 158.426V168.879C180 171.91 178.288 174.68 175.578 176.035L103.577 212.036C101.325 213.162 98.6745 213.162 96.4224 212.036L11.5771 169.623C6.25791 166.964 0 170.832 0 176.779V187.073C0 190.107 1.71689 192.881 4.43309 194.234L96.5051 240.096C98.7529 241.216 101.396 241.215 103.643 240.094L195.571 194.235C198.285 192.881 200 190.109 200 187.076V119.512C200 113.565 193.741 109.697 188.422 112.356L131.578 140.778C126.258 143.438 120 139.57 120 133.623V123.17C120 120.14 121.712 117.37 124.422 116.014L195.578 80.4368C198.288 79.0817 200 76.3116 200 73.2814V54.9713C200 51.9402 198.287 49.1695 195.576 47.8148L103.504 1.81227Z" fill="currentColor"/>
      </svg>
      <span className="font-medium text-[15px]">Stack Auth</span>
    </Link>
  );
}

/**
 * Account menu wrapper to keep the UserButton styling consistent
 * in the mobile navigation.
 */
function DocsAccountMenu({
  className,
}: {
  className?: string,
}) {
  const user = useUser();
  const isSignedIn = Boolean(user);
  const displayName = user?.displayName ?? 'Stack Auth';

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 rounded-xl border border-fd-border/80 bg-fd-muted/30 px-4 py-3',
        className,
      )}
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold text-fd-foreground">
          {isSignedIn ? displayName : 'Account'}
        </p>
        <p className="text-xs text-fd-muted-foreground">
          {isSignedIn ? 'Manage your Stack Auth profile and settings.' : 'Sign in to manage your Stack Auth account.'}
        </p>
      </div>
      <div className="flex-shrink-0">
        <UserButton />
      </div>
    </div>
  );
}

/**
 * Top link that highlights when the current page matches
 */
function TopNavLink({ href, activePrefix, children }: { href: string, activePrefix?: string, children: ReactNode }) {
  const pathname = usePathname();
  const prefix = activePrefix ?? href;
  let isActive = pathname === prefix || pathname.startsWith(prefix + '/');

  // If using a broad activePrefix, check that no other more-specific top link matches
  if (isActive && activePrefix) {
    const moreSpecificMatch = docsConfig.topLinks.some(
      (link) => link.href !== href && (pathname === link.href || pathname.startsWith(link.href + '/'))
    );
    if (moreSpecificMatch) {
      isActive = false;
    }
  }

  return (
    <Link
      href={href}
      className={cn(
        'text-sm font-medium transition-colors whitespace-nowrap border-b-2 py-1',
        isActive
          ? 'text-fd-foreground border-fd-foreground'
          : 'text-fd-muted-foreground hover:text-fd-foreground border-transparent'
      )}
    >
      {children}
    </Link>
  );
}

/**
 * SHARED HEADER COMPONENT
 *
 * Single-row header with logo, top links, search, and utility buttons.
 */
export function SharedHeader({
  showSearch = false,
  children,
  onMobileMenuClick,
  sidebarContent
}: SharedHeaderProps) {
  const pathname = usePathname();
  const sidebarContext = useSidebar();
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const isTocOpen = sidebarContext?.isTocOpen ?? false;
  const setTocOpen = sidebarContext?.setTocOpen;

  // Close mobile nav when pathname changes
  useEffect(() => {
    setShowMobileNav(false);
  }, [pathname]);

  // Close TOC when navigating to SDK pages (but don't affect chat)
  useEffect(() => {
    if (!setTocOpen) return;
    if (!isInSdkSection(pathname)) return;
    if (isTocOpen) {
      setTocOpen(false);
    }
  }, [pathname, isTocOpen, setTocOpen]);

  // Prevent body scroll when mobile nav is open
  useEffect(() => {
    if (showMobileNav) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [showMobileNav]);

  const handleMobileMenuClick = () => {
    if (onMobileMenuClick) {
      onMobileMenuClick();
    } else {
      setShowMobileNav(!showMobileNav);
    }
  };

  return (
    <>
      <header className="sticky top-0 w-full h-14 z-49 flex flex-col space-around bg-fd-background">

        {/* Single row */}
        <div className="flex items-center justify-between h-14 border-b border-fd-border px-4 md:px-6">
          {/* Left side - Stack Auth Logo + Top Links */}
          <div className="flex items-center gap-10 relative z-10">
            <StackAuthLogo />

            {/* Top navigation links - hidden on mobile */}
            <nav className="hidden md:flex items-center gap-5">
              {docsConfig.topLinks.map((link) => (
                <TopNavLink key={link.href} href={link.href} activePrefix={link.activePrefix}>
                  {link.title}
                </TopNavLink>
              ))}
            </nav>
          </div>

          {/* Right side - Search and utilities */}
          <div className="flex items-center gap-4 relative z-10">
            {/* Search Bar - Responsive sizing */}
            {showSearch && (
              <>
                <div className="w-9 sm:w-32 md:w-48 lg:w-64">
                  <SearchInputToggle
                    onOpen={() => setSearchOpen(true)}
                  />
                </div>
                <CustomSearchDialog
                  open={searchOpen}
                  onOpenChange={setSearchOpen}
                />
              </>
            )}

            {/* Zen Toggle Button */}
            <ZenToggleButton className='hidden md:flex' />

            {/* Theme Toggle */}
            <ThemeToggle mode="light-dark" compact className="hidden md:inline-flex" />

            {/* Auth Toggle Button */}
            <AuthToggleButton className='hidden md:flex' />

            {/* User Button */}
            <div className="hidden md:block">
              <UserButton />
            </div>

            {/* Mobile Hamburger Menu - Shown on mobile */}
            <div className="flex lg:hidden">
              <button
                onClick={handleMobileMenuClick}
                className="flex items-center gap-2 text-sm font-medium transition-colors py-1 px-2 text-fd-muted-foreground hover:text-fd-foreground"
                aria-label="Toggle navigation menu"
              >
                {showMobileNav ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                <span>{showMobileNav ? 'Close' : 'Menu'}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Overlay */}
      {showMobileNav && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setShowMobileNav(false)}
          />

          {/* Mobile Navigation Panel */}
          <div className="fixed top-14 left-0 right-0 bottom-0 z-50 bg-fd-background lg:hidden overflow-y-auto">
            <div className="p-6 space-y-6">
              {/* User Authentication */}
              <div>
                <h2 className="text-lg font-semibold text-fd-foreground mb-4">Account</h2>
                <DocsAccountMenu />
              </div>

              {/* Sidebar Content */}
              {sidebarContent && (
                <div>
                  <h2 className="text-lg font-semibold text-fd-foreground mb-4">Navigation</h2>
                  <div className="space-y-1">
                    {sidebarContent}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
