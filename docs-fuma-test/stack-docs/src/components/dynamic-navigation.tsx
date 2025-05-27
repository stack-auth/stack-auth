'use client';
import { usePathname } from 'fumadocs-core/framework';
import type { LinkItemType } from 'fumadocs-ui/layouts/links';
import { Code2, Hammer, Home, Puzzle } from 'lucide-react';
import { DEFAULT_PLATFORM, getCurrentPlatform, getPlatformUrl } from '../lib/platform-utils';

export function useDynamicNavigation(): LinkItemType[] {
  const pathname = usePathname();
  const currentPlatform = getCurrentPlatform(pathname) || DEFAULT_PLATFORM;

  return [
    {
      type: 'main',
      text: "Documentation",
      url: getPlatformUrl(currentPlatform, ""),
      active: "url",
      icon: <Home />
    },
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
    },
    {
      type: 'main',
      text: "REST API & Webhooks",
      url: getPlatformUrl(currentPlatform, "api/overview"),
      active: "url",
      icon: <Code2 />
    }
  ];
} 
