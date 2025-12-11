import { Book, Code, Home, Layers, Zap, type LucideIcon } from 'lucide-react';

export type NavLink = {
  href: string,
  label: string,
  icon: LucideIcon,
}

const DOCS_OVERVIEW_PATH = '/docs/overview';
const DOCS_GUIDES_PATH = '/docs/getting-started/setup';
const DOCS_SDK_PATH = '/docs/sdk';
const DOCS_COMPONENTS_PATH = '/docs/components';
const API_OVERVIEW_PATH = '/api/overview';

export function generateNavLinks(): NavLink[] {
  return [
    {
      href: DOCS_OVERVIEW_PATH,
      label: 'Welcome',
      icon: Home,
    },
    {
      href: DOCS_GUIDES_PATH,
      label: 'Guides',
      icon: Book,
    },
    {
      href: DOCS_SDK_PATH,
      label: 'SDK',
      icon: Code,
    },
    {
      href: DOCS_COMPONENTS_PATH,
      label: 'Components',
      icon: Layers,
    },
    {
      href: API_OVERVIEW_PATH,
      label: 'API Reference',
      icon: Zap,
    },
  ];
}

export const DOCS_NAV_PATHS = {
  guides: DOCS_GUIDES_PATH,
  sdk: DOCS_SDK_PATH,
  components: DOCS_COMPONENTS_PATH,
};
