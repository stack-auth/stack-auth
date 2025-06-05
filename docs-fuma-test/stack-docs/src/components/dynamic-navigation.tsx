'use client';
import { usePathname } from 'fumadocs-core/framework';
import type { LinkItemType } from 'fumadocs-ui/layouts/links';
import { Code2, Hammer, Home, Puzzle } from 'lucide-react';
import { DEFAULT_PLATFORM, getCurrentPlatform, getPlatformUrl } from '../lib/platform-utils';

export function useDynamicNavigation(): LinkItemType[] {
  const pathname = usePathname();
  const currentPlatform = getCurrentPlatform(pathname) || DEFAULT_PLATFORM;

  const baseNavigation: LinkItemType[] = [
    {
      type: 'main',
      text: "Documentation",
      url: getPlatformUrl(currentPlatform, "overview"),
      active: "url",
      icon: <Home />
    }
  ];

  // Only show Components and SDK Reference for non-Python platforms
  if (currentPlatform !== 'python') {
    baseNavigation.push(
      {
        type: 'main',
        text: "Components",
        url: getPlatformUrl(currentPlatform, "components/overview"),
        active: "url",
        icon: <Puzzle />,
      },
      {
        type: 'main',
        text: "SDK Reference",
        url: getPlatformUrl(currentPlatform, "sdk/overview"),
        active: "url",
        icon: <Hammer />
      }
    );
  }

  // Add REST API & Webhooks for all platforms - point to shared API docs
  baseNavigation.push({
    type: 'main',
    text: "REST API & Webhooks",
    url: "/docs/api/overview",
    active: "url",
    icon: <Code2 />
  });

  return baseNavigation;
} 
