'use client';
import { usePlatformPersistence } from '@/hooks/use-platform-persistence';
import { generateNavLinks } from '@/lib/navigation-utils';
import { SharedHeader } from './shared-header';

interface PlatformAwareHeaderProps {
  /** Whether to show the search bar */
  showSearch?: boolean;
  /** Custom positioning classes */
  className?: string;
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
  className 
}: PlatformAwareHeaderProps) {
  const platform = usePlatformPersistence();
  const navLinks = generateNavLinks(platform);

  return (
    <SharedHeader 
      navLinks={navLinks}
      showSearch={showSearch}
      className={className}
    />
  );
} 
