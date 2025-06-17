'use client';
import { LargeSearchToggle } from '@/components/layout/search-toggle';
import Waves from '@/components/layouts/api/waves';
import { isInApiSection, isInComponentsSection, isInSdkSection } from '@/components/layouts/shared/section-utils';
import { type NavLink } from '@/lib/navigation-utils';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

type SharedHeaderProps = {
  /** Navigation links to display */
  navLinks: NavLink[],
  /** Whether to show the search bar */
  showSearch?: boolean,
  /** Custom positioning classes - defaults to fixed positioning for docs */
  className?: string,
  /** Additional content to render after nav links */
  children?: ReactNode,
  /** Whether to show mobile menu button */
  showMobileMenu?: boolean,
  /** Mobile menu click handler */
  onMobileMenuClick?: () => void,
  /** Sidebar content to show in mobile navigation */
  sidebarContent?: ReactNode,
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
 * SHARED HEADER COMPONENT
 *
 * Reusable header with Waves background used across docs and API layouts.
 * Provides consistent styling and behavior while allowing customization
 * for different layout requirements.
 *
 * FEATURES:
 * - Animated Waves background
 * - Configurable navigation links with icons and active states
 * - Optional search bar
 * - Flexible positioning
 * - Consistent styling across layouts
 * - Platform-aware navigation links
 * - Fully responsive design with mobile hamburger menu
 * - Independent mobile navigation overlay
 * - Dynamic sidebar content integration
 */
export function SharedHeader({
  navLinks,
  showSearch = false,
  className = "fixed top-0 left-0 right-0 md:left-64 z-50 h-14 border-b border-fd-border flex items-center justify-between px-4 md:px-6 bg-fd-background",
  children,
  showMobileMenu = false,
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

        {/* Desktop Navigation Links - Hidden on mobile */}
        <div className="hidden lg:flex items-center gap-6 relative z-10">
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

        {/* Mobile Hamburger Menu - Shown on mobile */}
        <div className="flex lg:hidden items-center relative z-10">
          <button
            onClick={handleMobileMenuClick}
            className="flex items-center gap-2 text-sm font-medium transition-colors py-1 px-2 text-fd-muted-foreground hover:text-fd-foreground"
            aria-label="Toggle navigation menu"
          >
            {showMobileNav ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            <span>{showMobileNav ? 'Close' : 'Menu'}</span>
          </button>
        </div>

        {/* Search Bar - Responsive sizing */}
        {showSearch && (
          <div className="relative z-10 w-32 sm:w-48 lg:w-64">
            <LargeSearchToggle
              hideIfDisabled
              className="w-full"
            />
          </div>
        )}
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
