'use client';
import { usePlatformPersistence } from '@/hooks/use-platform-persistence';
import { generateNavLinks } from '@/lib/navigation-utils';
import type { ReactNode } from 'react';
import { SharedHeader } from './shared-header';

type PlatformAwareHeaderProps = {
  /** Whether to show the search bar */
  showSearch?: boolean,
  /** Custom positioning classes */
  className?: string,
  /** Mobile menu click handler */
  onMobileMenuClick?: () => void,
  /** Sidebar content to show in mobile navigation */
  sidebarContent?: ReactNode,
}

/**
 * PLATFORM-AWARE HEADER WRAPPER
 *
 * Client component that wraps SharedHeader with platform persistence logic.
 * This allows the header to remember the user's last visited platform
 * when navigating between docs and API sections.
 */
export function PlatformAwareHeader({
  showSearch = false,
  className,
  onMobileMenuClick,
  sidebarContent
}: PlatformAwareHeaderProps) {
  const platform = usePlatformPersistence();
  const navLinks = generateNavLinks(platform);

  return (
    <SharedHeader
      navLinks={navLinks}
      showSearch={showSearch}
      className={className}
      onMobileMenuClick={onMobileMenuClick}
      sidebarContent={sidebarContent}
    />
  );
}
