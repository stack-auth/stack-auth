'use client';

import Link from 'fumadocs-core/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { DEFAULT_PLATFORM, getCurrentPlatform, getPlatformUrl } from '../../lib/platform-utils';
import { Box, Code, Zap } from '../icons';

type SDKItem = {
  name: string,
  href: string,
  icon: 'object' | 'type' | 'hook',
}

type SDKSection = {
  title: string,
  items: SDKItem[],
}

type SDKOverviewProps = {
  sections: SDKSection[],
}

function getIconForType(type: string): ReactNode {
  switch (type) {
    case 'object': {
      return <Box className="h-4 w-4" />;
    }
    case 'type': {
      return <Code className="h-4 w-4" />;
    }
    case 'hook': {
      return <Zap className="h-4 w-4" />;
    }
    default: {
      return <Box className="h-4 w-4" />;
    }
  }
}

function getColorForType(type: string): string {
  switch (type) {
    case 'object': {
      return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/50';
    }
    case 'type': {
      return 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/50 border-violet-200 dark:border-violet-800/50';
    }
    case 'hook': {
      return 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/50 border-orange-200 dark:border-orange-800/50';
    }
    default: {
      return 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-950/50 border-gray-200 dark:border-gray-800/50';
    }
  }
}

export function SDKOverview({ sections }: SDKOverviewProps) {
  const pathname = usePathname();
  const currentPlatform = getCurrentPlatform(pathname);

  // Function to build proper absolute URLs for SDK links
  const buildSDKUrl = (href: string): string => {
    // If href already starts with /, it's already absolute
    if (href.startsWith('/')) return href;

    // Use the current platform or fallback to default platform
    const platform = currentPlatform || DEFAULT_PLATFORM;

    // Build the absolute URL using getPlatformUrl utility
    return getPlatformUrl(platform, `sdk/${href}`);
  };

  return (
    <div className="grid gap-8 mt-6">
      {sections.map((section, sectionIndex) => (
        <div key={sectionIndex} className="space-y-4">
          <div className="border-b border-fd-border pb-2">
            <h3 className="text-lg font-semibold text-fd-foreground">{section.title}</h3>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item, itemIndex) => (
              <Link
                key={itemIndex}
                href={buildSDKUrl(item.href)}
                className={cn(
                  'group relative flex items-center gap-3 p-4 rounded-lg border transition-all duration-200',
                  'hover:shadow-md hover:shadow-fd-primary/5 hover:border-fd-primary/20',
                  'bg-fd-card/30 hover:bg-fd-card/50',
                  'border-fd-border hover:border-fd-primary/30'
                )}
              >
                <div className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-md border flex-shrink-0',
                  getColorForType(item.icon)
                )}>
                  {getIconForType(item.icon)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-medium text-fd-foreground group-hover:text-fd-primary transition-colors">
                    {item.name}
                  </div>
                  <div className="text-xs text-fd-muted-foreground mt-0.5 capitalize">
                    {item.icon}
                  </div>
                </div>

                {/* Subtle arrow indicator */}
                <div className="text-fd-muted-foreground group-hover:text-fd-primary transition-colors opacity-0 group-hover:opacity-100">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
