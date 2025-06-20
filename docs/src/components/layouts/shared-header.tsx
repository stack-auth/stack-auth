'use client';
import { LargeSearchToggle } from '@/components/layout/search-toggle';
import Waves from '@/components/layouts/api/waves';
import { isInApiSection, isInComponentsSection, isInSdkSection } from '@/components/layouts/shared/section-utils';
import { type NavLink } from '@/lib/navigation-utils';
import { List, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useTOC } from './toc-context';

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
 * Inner TOC Toggle Button that uses the context
 */
function TOCToggleButtonInner() {
  const { isTocOpen, toggleToc } = useTOC();

  return (
    <button
      onClick={toggleToc}
      className={`flex items-center justify-center gap-2 shadow-lg transition-all duration-300 w-24 h-8 rounded-lg text-sm font-medium ${
        isTocOpen
          ? 'bg-fd-foreground text-fd-background'
          : 'bg-fd-muted text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/80'
      }`}
      title={isTocOpen ? 'Hide table of contents' : 'Show table of contents'}
    >
      <List className="w-4 h-4 flex-shrink-0" />
      <span className="hidden sm:inline">
        {isTocOpen ? 'Hide' : 'TOC'}
      </span>
    </button>
  );
}

/**
 * TOC Toggle Button Wrapper that safely checks full page state
 */
function TOCToggleButtonWrapper() {
  const { isFullPage } = useTOC();

  // Hide TOC button on full pages
  if (isFullPage) return null;

  return <TOCToggleButtonInner />;
}

/**
 * TOC Toggle Button - Only shows on docs pages
 */
function TOCToggleButton() {
  const pathname = usePathname();

  // Only show on docs pages (not API pages)
  const isDocsPage = pathname.startsWith('/docs') && !isInApiSection(pathname);

  if (!isDocsPage) return null;

  try {
    return <TOCToggleButtonWrapper />;
  } catch {
    // TOC context not available
    return null;
  }
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
            <div className="w-32 sm:w-48 lg:w-64">
              <LargeSearchToggle
                hideIfDisabled
                className="w-full"
              />
            </div>
          )}

          {/* TOC Toggle Button - Only on docs pages */}
          <div className="hidden md:block">
            <TOCToggleButton />
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
