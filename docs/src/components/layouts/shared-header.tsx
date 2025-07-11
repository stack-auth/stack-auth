'use client';
import { CustomSearchDialog } from '@/components/layout/custom-search-dialog';
import { SearchInputToggle } from '@/components/layout/custom-search-toggle';
import Waves from '@/components/layouts/api/waves';
import { type NavLink } from '@/lib/navigation-utils';
import { Key, Menu, Sparkles, TableOfContents, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { useSidebar } from './sidebar-context';

type SharedHeaderProps = {
  /** Navigation links to display */
  navLinks: NavLink[],
  /** Whether to show the search bar */
  showSearch?: boolean,
  /** Custom positioning classes - defaults to fixed positioning for docs */
  className?: string,
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
  // Match the actual SDK section: /docs/platform/sdk or /docs/platform/sdk/...
  // This excludes docs pages that might mention SDK in other contexts
  const match = pathname.match(/^\/docs\/[^\/]+\/sdk($|\/)/);
  return Boolean(match);
}

export function isInComponentsSection(pathname: string): boolean {
  // Match the actual Components section: /docs/platform/components or /docs/platform/components/...
  // This excludes docs pages like /docs/platform/getting-started/components
  const match = pathname.match(/^\/docs\/[^\/]+\/components($|\/)/);
  return Boolean(match);
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
  if (navLink.label === 'SDK' && isInSdkSection(pathname)) {
    return true;
  }
  if (navLink.label === 'Components' && isInComponentsSection(pathname)) {
    return true;
  }
  if (navLink.label === 'API Reference' && isInApiSection(pathname)) {
    return true;
  }
  if (navLink.label === 'Documentation' && pathname.startsWith('/docs') &&
      !isInComponentsSection(pathname) && !isInSdkSection(pathname)) {
    return true;
  }
  return false;
}

/**
 * AI Chat Toggle Button
 */
function AIChatToggleButton() {
  const sidebarContext = useSidebar();

  // Return null if context is not available
  if (!sidebarContext) {
    return null;
  }

  const { toggleChat } = sidebarContext;

  return (
    <button
      className={cn(
        'flex items-center justify-center rounded-md w-8 h-8 text-xs transition-all duration-500 ease-out relative overflow-hidden',
        'text-white chat-gradient-active hover:scale-105 hover:brightness-110 hover:shadow-lg'
      )}
      onClick={toggleChat}
      title="AI Chat"
    >
      <Sparkles className="h-4 w-4 relative z-10" />
    </button>
  );
}

/**
 * Inner TOC Toggle Button that uses the context
 */
function TOCToggleButtonInner() {
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
        'flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors',
        isTocEffectivelyVisible
          ? 'bg-fd-primary/10 text-fd-primary hover:bg-fd-primary/20'
          : 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50'
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
function TOCToggleButton() {
  const pathname = usePathname();

  // Only show on docs pages (not API pages)
  const isDocsPage = pathname.startsWith('/docs') && !isInApiSection(pathname);

  if (!isDocsPage) return null;

  return <TOCToggleButtonInner />;
}

/**
 * Auth Toggle Button - Only shows on API pages
 */
function AuthToggleButton() {
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
          : 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50'
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
  className = "fixed top-0 left-0 right-0 z-50 h-14 border-b border-fd-border flex items-center justify-between px-4 md:px-6 bg-fd-background",
  children,
  onMobileMenuClick,
  sidebarContent
}: SharedHeaderProps) {
  const pathname = usePathname();
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Close mobile nav when pathname changes
  useEffect(() => {
    setShowMobileNav(false);
  }, [pathname]);

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
      <header className={className}>
        {/* Waves Background */}
        <div className="absolute inset-0 pointer-events-none">
          <Waves
            lineColor="rgba(29, 29, 29, 0.3)"
            backgroundColor="transparent"
            waveSpeedX={0.01}
            waveSpeedY={0.005}
            waveAmpX={15}
            waveAmpY={8}
            xGap={12}
            yGap={20}
            className="opacity-10 dark:opacity-100"
          />
        </div>

        {/* Left side - Stack Auth Logo and Navigation */}
        <div className="flex items-center gap-6 relative z-10">
          {/* Stack Auth Logo - Always visible */}
          <StackAuthLogo />

          {/* Desktop Navigation Links - Hidden on mobile */}
          <div className="hidden lg:flex items-center gap-6">
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
          <div className="hidden md:block">
            <TOCToggleButton />
          </div>

          {/* Auth Toggle Button - Shows on all pages like AI Chat button */}
          <div className="hidden md:block">
            <AuthToggleButton />
          </div>

          {/* AI Chat Toggle Button */}
          <div className="hidden md:block">
            <AIChatToggleButton />
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
