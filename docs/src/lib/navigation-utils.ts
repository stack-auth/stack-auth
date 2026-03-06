import type { LucideIcon } from 'lucide-react';
import { docsConfig, getTabDefaultHref } from '../docs-config';

export type NavLink = {
  href: string,
  label: string,
  icon: LucideIcon,
}

export function generateNavLinks(): NavLink[] {
  return docsConfig.tabs.map((tab) => ({
    href: getTabDefaultHref(tab),
    label: tab.title,
    icon: tab.icon,
  }));
}
