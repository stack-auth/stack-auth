'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export function PlatformChangeNotifier() {
  const pathname = usePathname();

  useEffect(() => {
    // Extract platform from embedded docs URLs
    const extractPlatform = (path: string): string | null => {
      // Match patterns like /docs-embed/next/ or /docs-embed/react/
      const match = path.match(/\/docs-embed\/([^\/]+)\//);
      return match ? match[1] : null;
    };

    const platform = extractPlatform(pathname);
    if (platform) {
      // Send platform change message to parent window
      try {
        // Use specific dashboard origins for security
        const targetOrigin = process.env.NODE_ENV === 'development' 
          ? 'http://localhost:8101' 
          : 'https://app.stack-auth.com';
        
        window.parent.postMessage(
          { 
            type: 'PLATFORM_CHANGE', 
            platform,
            pathname 
          },
          targetOrigin
        );
      } catch (error) {
        // Ignore errors if not in iframe or cross-origin issues
        console.debug('Could not send platform change message:', error);
      }
    }
  }, [pathname]);

  // This component doesn't render anything
  return null;
}
