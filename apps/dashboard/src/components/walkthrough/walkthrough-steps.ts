export type WalkthroughStep = {
  id: string,
  path: string,
  cmdkSearch?: string,
  sidebarNavLabel?: string,
  title: string,
  description: string,
  spotlightPadding?: number,
};

export type SpotlightRect = {
  top: number,
  left: number,
  width: number,
  height: number,
};

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: 'overview-globe',
    path: '/',
    title: 'Global User Map',
    description: 'See where your users are around the world.',
    spotlightPadding: 12,
  },
  {
    id: 'overview-metrics',
    path: '/',
    title: 'Usage Metrics',
    description: 'Track daily active users and sign-ups at a glance.',
    spotlightPadding: 12,
  },
  {
    id: 'users-table',
    path: '/users',
    cmdkSearch: 'Authentication',
    title: 'User Management',
    description: 'Manage all your users — search, export, or create new ones.',
  },
  {
    id: 'teams-table',
    path: '/teams',
    cmdkSearch: 'Teams',
    title: 'Teams',
    description: 'Organize users into teams for multi-tenant apps.',
  },
  {
    id: 'emails-sent',
    path: '/email-sent',
    cmdkSearch: 'Emails',
    title: 'Email Logs',
    description: 'Monitor sent emails, delivery status, and domain reputation.',
  },
  {
    id: 'payments-products',
    path: '/payments/products',
    cmdkSearch: 'Payments',
    title: 'Products & Pricing',
    description: 'Define products, pricing, and subscriptions.',
  },
  {
    id: 'analytics-replays',
    path: '/analytics/replays',
    sidebarNavLabel: 'Replays',
    title: 'Session Replays',
    description: 'Watch real user sessions to understand how people use your app.',
  },
];
