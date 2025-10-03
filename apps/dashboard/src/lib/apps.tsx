// Define app types locally since they're only available at compile time
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
import {
    CheckSquare,
    Cloud,
    CreditCard,
    Database,
    Key,
    Lock,
    Mail,
    Server,
    Shield,
    Tv,
    Users,
    Webhook,
    Workflow,
    Zap
} from 'lucide-react';
import { ComponentType } from 'react';

// App icon component type
export type AppIconComponent = ComponentType<{ size?: number | string; className?: string }>;

// App screenshot component type  
export type AppScreenshotComponent = ComponentType<{ className?: string }>;

// App description component type
export type AppDescriptionComponent = ComponentType<{ className?: string }>;

// Dashboard app definition interface
export interface DashboardAppDefinition {
  id: AppId;
  type: AppType;
  displayName: string;
  subtitle: string;
  tags: string[];
  icon: AppIconComponent;
  screenshots: AppScreenshotComponent[];
  description: AppDescriptionComponent;
}

// Placeholder screenshot components
const AuthenticationScreenshots = () => (
  <div className="grid grid-cols-2 gap-4">
    <div className="bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg p-6 text-white">
      <h3 className="font-semibold mb-2">Sign-in Methods</h3>
      <p className="text-sm opacity-90">Configure OAuth, password, and passkey authentication</p>
    </div>
    <div className="bg-gradient-to-br from-green-500 to-teal-600 rounded-lg p-6 text-white">
      <h3 className="font-semibold mb-2">User Management</h3>
      <p className="text-sm opacity-90">View and manage user accounts and sessions</p>
    </div>
  </div>
);

const TeamsScreenshots = () => (
  <div className="grid grid-cols-2 gap-4">
    <div className="bg-gradient-to-br from-orange-500 to-red-600 rounded-lg p-6 text-white">
      <h3 className="font-semibold mb-2">Team Dashboard</h3>
      <p className="text-sm opacity-90">Manage team members and permissions</p>
    </div>
    <div className="bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg p-6 text-white">
      <h3 className="font-semibold mb-2">Invitations</h3>
      <p className="text-sm opacity-90">Send and manage team invitations</p>
    </div>
  </div>
);

const RBACScreenshots = () => (
  <div className="grid grid-cols-2 gap-4">
    <div className="bg-gradient-to-br from-indigo-500 to-blue-600 rounded-lg p-6 text-white">
      <h3 className="font-semibold mb-2">Role Management</h3>
      <p className="text-sm opacity-90">Define custom roles and permissions</p>
    </div>
    <div className="bg-gradient-to-br from-teal-500 to-cyan-600 rounded-lg p-6 text-white">
      <h3 className="font-semibold mb-2">Access Control</h3>
      <p className="text-sm opacity-90">Fine-grained permission management</p>
    </div>
  </div>
);

const APIKeysScreenshots = () => (
  <div className="grid grid-cols-2 gap-4">
    <div className="bg-gradient-to-br from-yellow-500 to-orange-600 rounded-lg p-6 text-white">
      <h3 className="font-semibold mb-2">API Key Dashboard</h3>
      <p className="text-sm opacity-90">Create and manage API keys</p>
    </div>
    <div className="bg-gradient-to-br from-red-500 to-pink-600 rounded-lg p-6 text-white">
      <h3 className="font-semibold mb-2">Usage Analytics</h3>
      <p className="text-sm opacity-90">Track API key usage and limits</p>
    </div>
  </div>
);

const PaymentsScreenshots = () => (
  <div className="grid grid-cols-2 gap-4">
    <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg p-6 text-white">
      <h3 className="font-semibold mb-2">Payment Dashboard</h3>
      <p className="text-sm opacity-90">Manage subscriptions and billing</p>
    </div>
    <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg p-6 text-white">
      <h3 className="font-semibold mb-2">Transaction History</h3>
      <p className="text-sm opacity-90">View payment and transaction records</p>
    </div>
  </div>
);

const EmailsScreenshots = () => (
  <div className="grid grid-cols-2 gap-4">
    <div className="bg-gradient-to-br from-purple-500 to-violet-600 rounded-lg p-6 text-white">
      <h3 className="font-semibold mb-2">Email Templates</h3>
      <p className="text-sm opacity-90">Design and customize email templates</p>
    </div>
    <div className="bg-gradient-to-br from-pink-500 to-rose-600 rounded-lg p-6 text-white">
      <h3 className="font-semibold mb-2">Email Analytics</h3>
      <p className="text-sm opacity-90">Track email delivery and engagement</p>
    </div>
  </div>
);

// Placeholder description components
const AuthenticationDescription = () => (
  <div className="space-y-4">
    <p>
      Secure user authentication with multiple sign-in methods including OAuth providers, 
      password authentication, and passkey support. Manage user sessions, implement 
      multi-factor authentication, and configure security policies.
    </p>
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <h4 className="font-semibold mb-2">Features</h4>
        <ul className="space-y-1 text-gray-600">
          <li>• OAuth integration</li>
          <li>• Password authentication</li>
          <li>• Passkey support</li>
          <li>• Session management</li>
        </ul>
      </div>
      <div>
        <h4 className="font-semibold mb-2">Security</h4>
        <ul className="space-y-1 text-gray-600">
          <li>• MFA support</li>
          <li>• Rate limiting</li>
          <li>• Security policies</li>
          <li>• Audit logging</li>
        </ul>
      </div>
    </div>
  </div>
);

const TeamsDescription = () => (
  <div className="space-y-4">
    <p>
      Team management and collaboration features that allow you to organize users into 
      teams, manage team memberships, and control access to resources. Perfect for 
      multi-user applications and enterprise environments.
    </p>
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <h4 className="font-semibold mb-2">Team Features</h4>
        <ul className="space-y-1 text-gray-600">
          <li>• Team creation</li>
          <li>• Member management</li>
          <li>• Team invitations</li>
          <li>• Team settings</li>
        </ul>
      </div>
      <div>
        <h4 className="font-semibold mb-2">Collaboration</h4>
        <ul className="space-y-1 text-gray-600">
          <li>• Shared resources</li>
          <li>• Team permissions</li>
          <li>• Activity feeds</li>
          <li>• Notifications</li>
        </ul>
      </div>
    </div>
  </div>
);

// Dashboard app definitions
export const DASHBOARD_APPS: Record<AppId, DashboardAppDefinition> = {
  // Regular Apps
  'authentication': {
    id: 'authentication',
    type: 'app',
    displayName: 'Authentication',
    subtitle: 'Secure user authentication with multiple sign-in methods',
    tags: ['auth', 'security', 'users'],
    icon: Shield,
    screenshots: [AuthenticationScreenshots],
    description: AuthenticationDescription,
  },
  'teams': {
    id: 'teams',
    type: 'app',
    displayName: 'Teams',
    subtitle: 'Team management and collaboration features',
    tags: ['teams', 'collaboration', 'organization'],
    icon: Users,
    screenshots: [TeamsScreenshots],
    description: TeamsDescription,
  },
  'rbac': {
    id: 'rbac',
    type: 'app',
    displayName: 'RBAC',
    subtitle: 'Role-based access control and permissions',
    tags: ['rbac', 'permissions', 'security'],
    icon: Lock,
    screenshots: [RBACScreenshots],
    description: () => (
      <div className="space-y-4">
        <p>
          Role-based access control system that allows you to define custom roles and 
          permissions. Control access to resources with fine-grained permissions and 
          manage user capabilities across your application.
        </p>
      </div>
    ),
  },
  'api-keys': {
    id: 'api-keys',
    type: 'app',
    displayName: 'API Keys',
    subtitle: 'API key management and authentication',
    tags: ['api', 'keys', 'authentication'],
    icon: Key,
    screenshots: [APIKeysScreenshots],
    description: () => (
      <div className="space-y-4">
        <p>
          Generate and manage API keys for programmatic access to your application. 
          Track usage, set limits, and control access to your APIs with comprehensive 
          key management features.
        </p>
      </div>
    ),
  },
  'payments': {
    id: 'payments',
    type: 'app',
    displayName: 'Payments',
    subtitle: 'Payment processing and subscription management',
    tags: ['payments', 'billing', 'subscriptions'],
    icon: CreditCard,
    screenshots: [PaymentsScreenshots],
    description: () => (
      <div className="space-y-4">
        <p>
          Complete payment processing solution with subscription management, 
          transaction tracking, and billing automation. Integrate with popular 
          payment providers and manage your revenue streams.
        </p>
      </div>
    ),
  },
  'emails': {
    id: 'emails',
    type: 'app',
    displayName: 'Emails',
    subtitle: 'Email templates and delivery management',
    tags: ['emails', 'templates', 'communication'],
    icon: Mail,
    screenshots: [EmailsScreenshots],
    description: () => (
      <div className="space-y-4">
        <p>
          Design and manage email templates with a visual editor. Track email 
          delivery, engagement metrics, and automate email workflows for better 
          user communication.
        </p>
      </div>
    ),
  },
  'email-api': {
    id: 'email-api',
    type: 'app',
    displayName: 'Email API',
    subtitle: 'Programmatic email sending and management',
    tags: ['emails', 'api', 'automation'],
    icon: Mail,
    screenshots: [EmailsScreenshots],
    description: () => (
      <div className="space-y-4">
        <p>
          Send emails programmatically with our powerful API. Integrate email 
          functionality into your applications with webhooks, templates, and 
          advanced delivery options.
        </p>
      </div>
    ),
  },
  'data-vault': {
    id: 'data-vault',
    type: 'app',
    displayName: 'Data Vault',
    subtitle: 'Secure data storage and encryption',
    tags: ['data', 'security', 'encryption'],
    icon: Database,
    screenshots: [() => <div className="bg-gradient-to-br from-gray-500 to-gray-700 rounded-lg p-6 text-white"><h3 className="font-semibold mb-2">Data Vault</h3><p className="text-sm opacity-90">Secure encrypted data storage</p></div>],
    description: () => (
      <div className="space-y-4">
        <p>
          Secure data storage solution with end-to-end encryption. Store sensitive 
          data with confidence using industry-standard encryption and access controls.
        </p>
      </div>
    ),
  },
  'workflows': {
    id: 'workflows',
    type: 'app',
    displayName: 'Workflows',
    subtitle: 'Automated workflow and process management',
    tags: ['workflows', 'automation', 'processes'],
    icon: Workflow,
    screenshots: [() => <div className="bg-gradient-to-br from-blue-500 to-cyan-600 rounded-lg p-6 text-white"><h3 className="font-semibold mb-2">Workflow Builder</h3><p className="text-sm opacity-90">Visual workflow automation</p></div>],
    description: () => (
      <div className="space-y-4">
        <p>
          Create and manage automated workflows with a visual builder. Connect 
          different services and automate complex business processes with ease.
        </p>
      </div>
    ),
  },
  'webhooks': {
    id: 'webhooks',
    type: 'app',
    displayName: 'Webhooks',
    subtitle: 'Event-driven integrations and notifications',
    tags: ['webhooks', 'integrations', 'events'],
    icon: Webhook,
    screenshots: [() => <div className="bg-gradient-to-br from-purple-500 to-violet-600 rounded-lg p-6 text-white"><h3 className="font-semibold mb-2">Webhook Dashboard</h3><p className="text-sm opacity-90">Manage event subscriptions</p></div>],
    description: () => (
      <div className="space-y-4">
        <p>
          Set up webhooks to receive real-time notifications about events in your 
          application. Integrate with external services and build event-driven 
          architectures.
        </p>
      </div>
    ),
  },
  'tv-mode': {
    id: 'tv-mode',
    type: 'app',
    displayName: 'TV Mode',
    subtitle: 'Large screen dashboard and monitoring',
    tags: ['tv', 'dashboard', 'monitoring'],
    icon: Tv,
    screenshots: [() => <div className="bg-gradient-to-br from-red-500 to-pink-600 rounded-lg p-6 text-white"><h3 className="font-semibold mb-2">TV Dashboard</h3><p className="text-sm opacity-90">Large screen monitoring</p></div>],
    description: () => (
      <div className="space-y-4">
        <p>
          Display your application metrics and data on large screens with TV mode. 
          Perfect for monitoring dashboards and public displays.
        </p>
      </div>
    ),
  },
  'launch-checklist': {
    id: 'launch-checklist',
    type: 'app',
    displayName: 'Launch Checklist',
    subtitle: 'Pre-launch verification and testing',
    tags: ['launch', 'checklist', 'testing'],
    icon: CheckSquare,
    screenshots: [() => <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg p-6 text-white"><h3 className="font-semibold mb-2">Launch Checklist</h3><p className="text-sm opacity-90">Pre-launch verification</p></div>],
    description: () => (
      <div className="space-y-4">
        <p>
          Comprehensive checklist to ensure your application is ready for launch. 
          Verify all components, test integrations, and validate your setup.
        </p>
      </div>
    ),
  },
  'catalyst': {
    id: 'catalyst',
    type: 'app',
    displayName: 'Catalyst',
    subtitle: 'Performance optimization and monitoring',
    tags: ['performance', 'optimization', 'monitoring'],
    icon: Zap,
    screenshots: [() => <div className="bg-gradient-to-br from-yellow-500 to-orange-600 rounded-lg p-6 text-white"><h3 className="font-semibold mb-2">Performance Dashboard</h3><p className="text-sm opacity-90">Real-time performance metrics</p></div>],
    description: () => (
      <div className="space-y-4">
        <p>
          Monitor and optimize your application performance with real-time metrics, 
          alerts, and optimization recommendations. Keep your application running 
          smoothly at scale.
        </p>
      </div>
    ),
  },
  // Integrations
  'neon': {
    id: 'neon',
    type: 'integration',
    displayName: 'Neon',
    subtitle: 'Serverless PostgreSQL database integration',
    tags: ['database', 'postgresql', 'serverless'],
    icon: Server,
    screenshots: [() => <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg p-6 text-white"><h3 className="font-semibold mb-2">Neon Dashboard</h3><p className="text-sm opacity-90">Database management</p></div>],
    description: () => (
      <div className="space-y-4">
        <p>
          Integrate with Neon's serverless PostgreSQL database. Manage your database 
          connections, monitor performance, and scale automatically with your application.
        </p>
      </div>
    ),
  },
  'convex': {
    id: 'convex',
    type: 'integration',
    displayName: 'Convex',
    subtitle: 'Real-time backend-as-a-service integration',
    tags: ['backend', 'realtime', 'database'],
    icon: Cloud,
    screenshots: [() => <div className="bg-gradient-to-br from-green-500 to-teal-600 rounded-lg p-6 text-white"><h3 className="font-semibold mb-2">Convex Dashboard</h3><p className="text-sm opacity-90">Real-time backend</p></div>],
    description: () => (
      <div className="space-y-4">
        <p>
          Connect with Convex for real-time backend functionality. Build reactive 
          applications with automatic data synchronization and real-time updates.
        </p>
      </div>
    ),
  },
};

// Helper functions
export function getDashboardApp(appId: AppId): DashboardAppDefinition {
  return DASHBOARD_APPS[appId];
}

export function getAllDashboardApps(): DashboardAppDefinition[] {
  return Object.values(DASHBOARD_APPS);
}

export function getDashboardAppsByType(type: AppType): DashboardAppDefinition[] {
  return Object.values(DASHBOARD_APPS).filter(app => app.type === type);
}

export function getRegularApps(): DashboardAppDefinition[] {
  return getDashboardAppsByType('app');
}

export function getIntegrations(): DashboardAppDefinition[] {
  return getDashboardAppsByType('integration');
}
