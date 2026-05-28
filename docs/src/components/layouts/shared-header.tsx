'use client';
import { CustomSearchDialog } from '@/components/layout/custom-search-dialog';
import { SearchInputToggle } from '@/components/layout/custom-search-toggle';
import { type NavLink } from '@/lib/navigation-utils';
import { UserButton, useUser } from '@stackframe/stack';
import { Key, Menu, Sparkles, TableOfContents, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { PlatformIndicator } from './platform-indicator';
import { useSidebar } from './sidebar-context';

type SharedHeaderProps = {
  /** Navigation links to display */
  navLinks: NavLink[],
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
  // Match the actual SDK section: /docs/sdk or /docs/sdk/...
  // This excludes docs pages that might mention SDK in other contexts
  return pathname === '/docs/sdk' || pathname.startsWith('/docs/sdk/');
}

export function isInComponentsSection(pathname: string): boolean {
  // Match the actual Components section: /docs/components or /docs/components/...
  // This excludes docs pages that might mention components in other contexts
  return pathname === '/docs/components' || pathname.startsWith('/docs/components/');
}

export function isInApiSection(pathname: string): boolean {
  return pathname.startsWith('/api');
}

/**
 * Determines if a navigation link should be highlighted as active
 * based on the current pathname.
 */
function isNavLinkActive(pathname: string, navLink: NavLink): boolean {
  // More specific matches first
  if (navLink.label === 'Welcome' && (pathname === '/docs/overview' || pathname === '/docs/faq')) {
    return true;
  }
  if (navLink.label === 'SDK' && isInSdkSection(pathname)) {
    return true;
  }
  if (navLink.label === 'Components' && isInComponentsSection(pathname)) {
    return true;
  }
  if (navLink.label === 'API Reference' && isInApiSection(pathname)) {
    return true;
  }
  if (navLink.label === 'Guides' && pathname.startsWith('/docs') &&
      !isInComponentsSection(pathname) && !isInSdkSection(pathname) && pathname !== '/docs/overview' && pathname !== '/docs/faq') {
    return true;
  }
  return false;
}

/**
 * AI Chat Toggle Button
 */
function AIChatToggleButton(props: { className: string }) {
  const sidebarContext = useSidebar();

  // Return null if context is not available
  if (!sidebarContext) {
    return null;
  }

  const { toggleChat } = sidebarContext;

  return (
    <button
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-all duration-500 ease-out relative overflow-hidden',
        'text-white chat-gradient-active hover:scale-105 hover:brightness-110 hover:shadow-lg',
        props.className,
      )}
      onClick={toggleChat}
      title="AI Chat"
    >
      <Sparkles className="h-3 w-3 relative z-10" />
      <span className="font-medium relative z-10">AI Chat</span>
    </button>
  );
}

/**
 * Inner TOC Toggle Button that uses the context
 */
function TOCToggleButtonInner(props: { className: string }) {
  const sidebarContext = useSidebar();

  // Return null if context is not available
  if (!sidebarContext) {
    return null;
  }

  const { isTocOpen, toggleToc, isChatOpen, isFullPage } = sidebarContext;

  // Hide TOC button on full pages
  if (isFullPage) return null;

  // When chat is open, TOC is effectively not visible
  const isTocEffectivelyVisible = isTocOpen && !isChatOpen;

  return (
    <button
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors border border-fd-border',
        isTocEffectivelyVisible
          ? 'bg-fd-primary/10 text-fd-primary hover:bg-fd-primary/20'
          : 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50',
        props.className
      )}
      onClick={toggleToc}
      title={isTocEffectivelyVisible ? 'Close table of contents' : 'Open table of contents'}
    >
      <TableOfContents className="h-3 w-3" />
      <span className="font-medium">Contents</span>
    </button>
  );
}

/**
 * TOC Toggle Button - Only shows on docs pages
 */
function TOCToggleButton(props: { className: string }) {
  const pathname = usePathname();

  // Only show on docs pages (not API pages or SDK pages)
  const isDocsPage = pathname.startsWith('/docs') && !isInApiSection(pathname) && !isInSdkSection(pathname);

  if (!isDocsPage) return null;

  return <TOCToggleButtonInner {...props} />;
}

/**
 * Auth Toggle Button - Only shows on API pages
 */
function AuthToggleButton(props: { className: string }) {
  const pathname = usePathname();
  const sidebarContext = useSidebar();

  // Only show on API pages
  const isAPIPage = isInApiSection(pathname);

  if (!isAPIPage) return null;

  // Return null if context is not available
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

// Hexclave Logo Component
function StackAuthLogo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-fd-foreground hover:text-fd-foreground/80 transition-colors">
      <svg
        width="24"
        height="24"
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Hexclave Logo"
        className="flex-shrink-0"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="miter"
      >
        <path d="M 24 4 L 41.32 14 L 41.32 34 L 24 44 L 6.68 34 L 6.68 14 Z"/>
        <path d="M 11 16.87 L 14 15.13 L 14 32.87 L 11 31.13 Z" fill="currentColor" stroke="none"/>
        <path d="M 11 16.87 L 14 15.13 L 14 32.87 L 11 31.13 Z" fill="currentColor" stroke="none" transform="rotate(120 24 24)"/>
        <path d="M 11 16.87 L 14 15.13 L 14 32.87 L 11 31.13 Z" fill="currentColor" stroke="none" transform="rotate(240 24 24)"/>
      </svg>
      <span className="font-medium text-[15px]">Hexclave</span>
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
 * SHARED HEADER COMPONENT
 *
 * Reusable header with Waves background used across docs and API layouts.
 * Provides consistent styling and behavior while allowing customization
 * for different layout requirements.
 *
 * FEATURES:
 * - Animated Waves background
 * - Stack Auth branding with logo and text
 * - Configurable navigation links with icons and active states
 * - Optional search bar
 * - Full-width design
 * - Consistent styling across layouts
 * - Platform-aware navigation links
 * - Fully responsive design with mobile hamburger menu
 * - Independent mobile navigation overlay
 * - Dynamic sidebar content integration
 */
export function SharedHeader({
  navLinks,
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
      <header className="sticky top-0 w-full h-14 lg:h-26 z-49 flex flex-col space-around bg-fd-background">

        {/* First row */}
        <div className="flex items-center justify-between h-14 border-b border-fd-border px-4 md:px-6">
          {/* Left side - Stack Auth Logo and Navigation */}
          <div className="flex items-center gap-6 relative z-10">
            {/* Stack Auth Logo - Always visible */}
            <StackAuthLogo />
          </div>

          {/* Right side - Mobile Menu and Search */}
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

            {/* TOC Toggle Button - Only on docs pages */}
            <TOCToggleButton className='hidden md:flex' />

            {/* Auth Toggle Button - Shows on all pages like AI Chat button */}
            <AuthToggleButton className='hidden md:flex' />

            {/* AI Chat Toggle Button */}
            <AIChatToggleButton className='hidden md:flex' />

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

        {/* Second row */}
        <div className="h-12 hidden lg:flex items-center justify-between border-b border-fd-border px-4 md:px-6">
          {/* Desktop Navigation Links - Hidden on mobile */}
          <div className="flex items-center gap-6">
            {navLinks.map((link, index) => {
              const isActive = isNavLinkActive(pathname, link);
              const IconComponent = link.icon;

              return (
                <Link
                  key={index}
                  href={link.href}
                  className={`flex items-center gap-2 text-sm font-medium transition-colors relative py-1 whitespace-nowrap ${
                    isActive
                      ? 'text-fd-foreground'
                      : 'text-fd-muted-foreground hover:text-fd-foreground'
                  }`}
                >
                  <IconComponent className="w-4 h-4 flex-shrink-0" />
                  <span>{link.label}</span>
                  {/* Active underline */}
                  {isActive && (
                    <div className="absolute -bottom-3 left-0 right-0 h-0.5 bg-fd-primary rounded-full" />
                  )}
                </Link>
              );
            })}
            {children}
          </div>

          {/* Platform/Framework Indicator - Right side */}
          <div className="flex items-center">
            <PlatformIndicator />
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
              {/* Top-level Navigation */}
              <div>
                {/* User Authentication */}
                <div>
                  <h2 className="text-lg font-semibold text-fd-foreground mb-4">Account</h2>
                  <DocsAccountMenu />
                  <br />
                </div>

                <h2 className="text-lg font-semibold text-fd-foreground mb-4">Navigation</h2>
                <div className="space-y-2">
                  {navLinks.map((link, index) => {
                    const isActive = isNavLinkActive(pathname, link);
                    const IconComponent = link.icon;

                    return (
                      <Link
                        key={index}
                        href={link.href}
                        onClick={() => setShowMobileNav(false)}
                        className={`flex items-center gap-4 px-4 py-3 rounded-lg text-base font-medium transition-colors ${
                          isActive
                            ? 'bg-fd-primary/10 text-fd-primary'
                            : 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50'
                        }`}
                      >
                        <IconComponent className="w-5 h-5 flex-shrink-0" />
                        <span>{link.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>


              {/* Sidebar Content */}
              {sidebarContent && (
                <div>
                  <h2 className="text-lg font-semibold text-fd-foreground mb-4">Browse</h2>
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
