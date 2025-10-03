export type AppId = 
  | 'authentication'
  | 'teams'
  | 'rbac'
  | 'api-keys'
  | 'payments'
  | 'emails'
  | 'email-api'
  | 'data-vault'
  | 'workflows'
  | 'webhooks'
  | 'tv-mode'
  | 'launch-checklist'
  | 'catalyst'
  | 'neon'
  | 'convex';

export type AppType = 'app' | 'integration';

export interface AppMetadata {
  id: AppId;
  type: AppType;
  displayName: string;
  subtitle: string;
  tags: string[];
}

export const APP_METADATA: Record<AppId, AppMetadata> = {
  // Regular Apps
  'authentication': {
    id: 'authentication',
    type: 'app',
    displayName: 'Authentication',
    subtitle: 'Secure user authentication with multiple sign-in methods',
    tags: ['auth', 'security', 'users']
  },
  'teams': {
    id: 'teams',
    type: 'app',
    displayName: 'Teams',
    subtitle: 'Team management and collaboration features',
    tags: ['teams', 'collaboration', 'organization']
  },
  'rbac': {
    id: 'rbac',
    type: 'app',
    displayName: 'RBAC',
    subtitle: 'Role-based access control and permissions',
    tags: ['permissions', 'security', 'access-control']
  },
  'api-keys': {
    id: 'api-keys',
    type: 'app',
    displayName: 'API Keys',
    subtitle: 'Manage API keys for secure access to your services',
    tags: ['api', 'keys', 'security']
  },
  'payments': {
    id: 'payments',
    type: 'app',
    displayName: 'Payments',
    subtitle: 'Payment processing and subscription management',
    tags: ['payments', 'billing', 'subscriptions']
  },
  'emails': {
    id: 'emails',
    type: 'app',
    displayName: 'Emails',
    subtitle: 'Email templates and delivery management',
    tags: ['emails', 'templates', 'communication']
  },
  'email-api': {
    id: 'email-api',
    type: 'app',
    displayName: 'Email API',
    subtitle: 'Programmatic email sending and management',
    tags: ['api', 'emails', 'automation']
  },
  'data-vault': {
    id: 'data-vault',
    type: 'app',
    displayName: 'Data Vault',
    subtitle: 'Secure encrypted storage for sensitive data',
    tags: ['storage', 'encryption', 'security']
  },
  'workflows': {
    id: 'workflows',
    type: 'app',
    displayName: 'Workflows',
    subtitle: 'Automated business processes and workflows',
    tags: ['automation', 'workflows', 'processes']
  },
  'webhooks': {
    id: 'webhooks',
    type: 'app',
    displayName: 'Webhooks',
    subtitle: 'Real-time event notifications and integrations',
    tags: ['webhooks', 'events', 'integrations']
  },
  'tv-mode': {
    id: 'tv-mode',
    type: 'app',
    displayName: 'TV Mode',
    subtitle: 'Large screen display mode for presentations',
    tags: ['display', 'presentation', 'tv']
  },
  'launch-checklist': {
    id: 'launch-checklist',
    type: 'app',
    displayName: 'Launch Checklist',
    subtitle: 'Step-by-step guide to launch your application',
    tags: ['launch', 'checklist', 'onboarding']
  },
  'catalyst': {
    id: 'catalyst',
    type: 'app',
    displayName: 'Catalyst',
    subtitle: 'Advanced features and experimental functionality',
    tags: ['advanced', 'experimental', 'features']
  },
  // Integrations
  'neon': {
    id: 'neon',
    type: 'integration',
    displayName: 'Neon',
    subtitle: 'Serverless PostgreSQL database integration',
    tags: ['database', 'postgresql', 'serverless']
  },
  'convex': {
    id: 'convex',
    type: 'integration',
    displayName: 'Convex',
    subtitle: 'Real-time backend-as-a-service integration',
    tags: ['backend', 'realtime', 'database']
  }
};

export const getAppMetadata = (appId: AppId): AppMetadata => {
  return APP_METADATA[appId];
};

export const getAllApps = (): AppMetadata[] => {
  return Object.values(APP_METADATA);
};

export const getAppsByType = (type: AppType): AppMetadata[] => {
  return Object.values(APP_METADATA).filter(app => app.type === type);
};
