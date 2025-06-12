import { LargeSearchToggle } from '@/components/layout/search-toggle';
import Waves from '@/components/layouts/api/Waves';
import { type NavLink } from '@/lib/navigation-utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

interface SharedHeaderProps {
  /** Navigation links to display */
  navLinks: NavLink[];
  /** Whether to show the search bar */
  showSearch?: boolean;
  /** Custom positioning classes - defaults to fixed positioning for docs */
  className?: string;
  /** Additional content to render after nav links */
  children?: ReactNode;
}

/**
 * Determines if a navigation link should be highlighted as active
 * based on the current pathname.
 */
function isNavLinkActive(pathname: string, navLink: NavLink): boolean {
  // More specific matches first
  if (navLink.label === 'SDK' && pathname.includes('/sdk')) {
    return true;
  }
  if (navLink.label === 'Components' && pathname.includes('/components')) {
    return true;
  }
  if (navLink.label === 'API Reference' && pathname.startsWith('/api')) {
    return true;
  }
  if (navLink.label === 'Documentation' && pathname.startsWith('/docs') && 
      !pathname.includes('/components') && !pathname.includes('/sdk')) {
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
 */
export function SharedHeader({ 
  navLinks, 
  showSearch = false, 
  className = "fixed top-0 left-64 right-0 z-50 h-14 border-b border-fd-border flex items-center justify-between px-6 bg-fd-background",
  children 
}: SharedHeaderProps) {
  const pathname = usePathname();

  return (
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
      
      {/* Navigation Links */}
      <div className="flex items-center gap-6 relative z-10">
        {navLinks.map((link, index) => {
          const isActive = isNavLinkActive(pathname, link);
          const IconComponent = link.icon;
          
          return (
            <Link
              key={index}
              href={link.href}
              className={`flex items-center gap-2 text-sm font-medium transition-colors relative py-1 ${
                isActive 
                  ? 'text-fd-foreground' 
                  : 'text-fd-muted-foreground hover:text-fd-foreground'
              }`}
            >
              <IconComponent className="w-4 h-4" />
              {link.label}
              {/* Active underline */}
              {isActive && (
                <div className="absolute -bottom-3 left-0 right-0 h-0.5 bg-fd-primary rounded-full" />
              )}
            </Link>
          );
        })}
        {children}
      </div>
      
      {/* Search Bar (optional) */}
      {showSearch && (
        <div className="relative z-10 max-w-sm w-full">
          <LargeSearchToggle 
            hideIfDisabled
            className="w-full"
          />
        </div>
      )}
    </header>
  );
} 
