'use client';

import { useRouter } from "@/components/router";
import { ErrorBoundary } from '@sentry/nextjs';
import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogTitle,
  ScrollArea
} from '@stackframe/stack-ui';
import Image from 'next/image';
import { useState } from 'react';
import { PageLayout } from "../../page-layout";
import { useAdminApp } from '../../use-admin-app';
import { GlobeSection } from './globe';
import { LineChartDisplayConfig } from './line-chart';


const stackAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type App = {
  image: string,
  name: string,
  url: string,
  enabled: boolean,
  shortDescription?: string,
  longDescription?: string,
  screenshots?: string[],
  category?: string,
  developer?: string,
}

const apps: App[] = [
  { image: '/apps/icons/auth.png', name: 'Auth', url: 'auth-methods', enabled: true },
  { image: '/apps/icons/analytics.png', name: 'Analytics', url: '.', enabled: true },
  { image: '/apps/icons/emails.png', name: 'Emails', url: 'emails', enabled: true },
  { image: '/apps/icons/api-keys.png', name: 'API Keys', url: 'api-keys', enabled: true },
  { image: '/apps/icons/rbac.png', name: 'RBAC', url: 'team-permissions', enabled: true },
  { image: '/apps/icons/support.png', name: 'Support', url: 'webhooks', enabled: true },
  {
    image: '/apps/icons/payments.png',
    name: 'Payments',
    url: 'project-settings',
    enabled: false,
    shortDescription: 'Accept payments and manage subscriptions',
    longDescription: `## Integrated Payment Processing

Add powerful payment capabilities to your application with support for:

- **Multiple payment methods** - Credit cards, ACH, digital wallets
- **Subscription management** - Recurring billing and plan management  
- **Global currencies** - Accept payments in 135+ currencies
- **PCI compliance** - Secure, compliant payment processing
- **Revenue analytics** - Track MRR, churn, and customer lifetime value

### Features
- One-time and recurring payments
- Customizable checkout flows
- Automated invoicing and receipts
- Dunning management for failed payments
- Webhook events for payment updates`,
    screenshots: ['https://via.placeholder.com/600x400', 'https://via.placeholder.com/600x400', 'https://via.placeholder.com/600x400'],
    category: 'Finance',
    developer: 'Stack Auth'
  },
  {
    image: '/apps/icons/fraud-detection.png',
    name: 'Fraud Detection',
    url: 'users',
    enabled: false,
    shortDescription: 'AI-powered fraud prevention and risk scoring',
    longDescription: `## Advanced Fraud Prevention

Protect your platform with intelligent fraud detection that learns and adapts:

- **Real-time risk scoring** - Evaluate transactions as they happen
- **Machine learning models** - Continuously improving detection
- **Custom rules engine** - Define your own fraud triggers
- **Device fingerprinting** - Track suspicious devices
- **IP reputation checks** - Identify high-risk locations

### Key Benefits
- Reduce chargebacks by up to 70%
- Block fraudulent accounts automatically
- Detailed risk analytics dashboard
- Integration with major fraud databases`,
    screenshots: ['https://via.placeholder.com/600x400', 'https://via.placeholder.com/600x400'],
    category: 'Security',
    developer: 'Stack Auth'
  },
  {
    image: '/apps/icons/marketing-emails.png',
    name: 'Marketing Emails',
    url: 'email-templates',
    enabled: false,
    shortDescription: 'Email campaigns and automation tools',
    longDescription: `## Email Marketing Automation

Engage your users with targeted email campaigns:

- **Drag-and-drop editor** - Create beautiful emails without code
- **Audience segmentation** - Target the right users
- **A/B testing** - Optimize your campaigns
- **Automation workflows** - Set up drip campaigns
- **Analytics** - Track opens, clicks, and conversions`,
    screenshots: ['https://via.placeholder.com/600x400', 'https://via.placeholder.com/600x400'],
    category: 'Marketing',
    developer: 'Stack Auth'
  },
  {
    image: '/apps/icons/referrals.png',
    name: 'Referrals',
    url: 'teams',
    enabled: false,
    shortDescription: 'Viral growth through referral programs',
    longDescription: `## Referral Program Management

Accelerate growth with built-in referral tracking:

- **Customizable rewards** - Points, discounts, or cash
- **Referral links** - Unique URLs for each user
- **Social sharing** - One-click sharing to social media
- **Leaderboards** - Gamify your referral program
- **Analytics** - Track viral coefficient and program ROI`,
    screenshots: ['https://via.placeholder.com/600x400', 'https://via.placeholder.com/600x400'],
    category: 'Growth',
    developer: 'Stack Auth'
  },
  {
    image: '/apps/icons/tv-mode.png',
    name: 'TV Mode',
    url: 'widget-playground',
    enabled: false,
    shortDescription: 'Display dashboards on office TVs',
    longDescription: `## TV Dashboard Display

Transform your office TVs into live dashboards:

- **Auto-refresh** - Keep data up-to-date
- **Fullscreen mode** - Optimized for TV displays
- **Rotating dashboards** - Cycle through multiple views
- **Custom layouts** - Design your perfect dashboard
- **Real-time updates** - See changes as they happen`,
    screenshots: ['https://via.placeholder.com/600x400'],
    category: 'Analytics',
    developer: 'Stack Auth'
  },
];

const dailySignUpsConfig = {
  name: 'Daily Sign-ups',
  description: 'User registration over the last 30 days',
  chart: {
    activity: {
      label: "Activity",
      color: "#cc6ce7",
    },
  }
} satisfies LineChartDisplayConfig;

const dauConfig = {
  name: 'Daily Active Users',
  description: 'Number of unique users that were active over the last 30 days',
  chart: {
    activity: {
      label: "Activity",
      color: "#2563eb",
    },
  }
} satisfies LineChartDisplayConfig;

function AppStoreDialog({ app, open, onOpenChange, onEnable }: {
  app: App | null,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onEnable: (app: App) => void,
}) {
  const [isEnabling, setIsEnabling] = useState(false);

  if (!app) return null;

  const handleEnable = async () => {
    setIsEnabling(true);
    await wait(1000);
    onEnable(app);
    setIsEnabling(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden p-0">
        <div className="flex flex-col h-full">
          {/* Header with app icon and basic info */}
          <div className="p-6 border-b">
            <div className="flex gap-4">
              <div className="relative w-24 h-24 rounded-[22%] shadow-md overflow-hidden">
                <Image
                  src={app.image}
                  alt={app.name}
                  fill
                  className="object-cover select-none"
                  draggable={false}
                />
              </div>
              <div className="flex-1">
                <DialogTitle className="text-2xl font-bold mb-1">{app.name}</DialogTitle>
                <p className="text-gray-600 dark:text-gray-400 mb-2">{app.shortDescription}</p>
                <div className="flex items-center gap-4 text-sm text-gray-500">
                  {app.developer && <span>{app.developer}</span>}
                  {app.category && <Badge variant="secondary">{app.category}</Badge>}
                </div>
              </div>
              <div>
                <Button
                  onClick={handleEnable}
                  size="lg"
                  className="px-8"
                  disabled={isEnabling}
                >
                  {isEnabling ? 'Enabling...' : 'Enable'}
                </Button>
              </div>
            </div>
          </div>

          {/* Screenshots */}
          {app.screenshots && app.screenshots.length > 0 && (
            <div className="border-b">
              <ScrollArea className="w-full">
                <div className="flex gap-4 p-6">
                  {app.screenshots.map((screenshot, index) => (
                    <div
                      key={index}
                      className="relative h-48 w-72 rounded-lg shadow-md flex-shrink-0 overflow-hidden"
                    >
                      <Image
                        src={screenshot}
                        alt={`${app.name} screenshot ${index + 1}`}
                        fill
                        className="object-cover select-none"
                        draggable={false}
                      />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Long description */}
          <ScrollArea className="flex-1 p-6">
            <div className="prose dark:prose-invert max-w-none">
              {app.longDescription ? (
                <div dangerouslySetInnerHTML={{
                  __html: app.longDescription.replace(/\n/g, '<br />').replace(/##/g, '<h2>').replace(/###/g, '<h3>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                }} />
              ) : (
                <p>No additional information available.</p>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AppSquare({ app, onClick, onToggleEnabled, projectId }: {
  app: App,
  onClick: (app: App) => void,
  onToggleEnabled: (app: App) => void,
  projectId: string,
}) {
  const handleClick = (e: React.MouseEvent) => {
    if (!app.enabled) {
      e.preventDefault();
      onClick(app);
    }
  };

  const handleOpenNewTab = () => {
    const fullUrl = app.url === '.' 
      ? `/projects/${encodeURIComponent(projectId)}` 
      : `/projects/${encodeURIComponent(projectId)}/${app.url}`;
    window.open(fullUrl, '_blank');
  };

  const appHref = app.enabled 
    ? (app.url === '.' 
      ? `/projects/${encodeURIComponent(projectId)}` 
      : `/projects/${encodeURIComponent(projectId)}/${app.url}`)
    : '#';

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <a
          href={appHref}
          onClick={handleClick}
          className="flex flex-col items-center gap-1 sm:gap-2 transition-all duration-200 cursor-pointer group select-none"
        >
          <div
            className={`relative block w-20 h-20 sm:w-28 sm:h-28 md:w-32 md:h-32 lg:w-36 lg:h-36 rounded-[22%] overflow-hidden shadow-md transition-all duration-200 ${
              app.enabled
                ? 'group-hover:shadow-xl group-hover:scale-110'
                : 'opacity-40 grayscale group-hover:opacity-60'
            }`}
          >
            <Image
              src={app.image}
              alt={app.name}
              fill
              className="object-cover select-none pointer-events-none"
              draggable={false}
            />
          </div>
          <span className={`text-xs sm:text-sm text-center max-w-20 sm:max-w-28 md:max-w-32 lg:max-w-36 truncate select-none ${
            app.enabled
              ? 'text-gray-700 dark:text-gray-300'
              : 'text-gray-500 dark:text-gray-500'
          }`}>
            {app.name}
          </span>
        </a>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleOpenNewTab}>
          Open in new tab
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onToggleEnabled(app)}>
          {app.enabled ? 'Disable' : 'Enable'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function MetricsPage(props: { toSetup: () => void }) {
  const adminApp = useAdminApp();
  const router = useRouter();
  const [selectedApp, setSelectedApp] = useState<App | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [appList, setAppList] = useState<App[]>(apps);

  const data = (adminApp as any)[stackAppInternalsSymbol].useMetrics();

  const enabledApps = appList.filter(app => app.enabled);
  const disabledApps = appList.filter(app => !app.enabled);

  const handleAppClick = (app: App) => {
    if (!app.enabled) {
      setSelectedApp(app);
      setDialogOpen(true);
    }
  };

  const handleEnableApp = (app: App) => {
    setAppList(prevApps =>
      prevApps.map(a =>
        a.name === app.name ? { ...a, enabled: true } : a
      )
    );
    setDialogOpen(false);
    // Navigate to the app after enabling
    const projectId = adminApp.projectId;
    if (app.url === '.') {
      router.push(`/projects/${encodeURIComponent(projectId)}`);
    } else {
      router.push(`/projects/${encodeURIComponent(projectId)}/${app.url}`);
    }
  };

  const handleToggleEnabled = (app: App) => {
    (async () => {
      if (!app.enabled) {
        // If enabling from context menu, show a brief delay
        await wait(1000);
      }
      setAppList(prevApps =>
        prevApps.map(a =>
          a.name === app.name ? { ...a, enabled: !a.enabled } : a
        )
      );
    })().catch(() => {
      // Error handling if needed
    });
  };

  return (
    <PageLayout fillWidth>
      <ErrorBoundary fallback={<div className='text-center text-sm text-red-500'>Error initializing globe visualization. Please try updating your browser or enabling WebGL.</div>}>
        <GlobeSection countryData={data.users_by_country} totalUsers={data.total_users} />
      </ErrorBoundary>

      <div className="my-8 px-4">
        <h2 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">Enabled apps</h2>
        <div className="flex flex-wrap gap-4 sm:gap-6 md:gap-8 lg:gap-10 justify-start">
          {enabledApps.map((app) => (
            <AppSquare
              key={app.name}
              app={app}
              onClick={handleAppClick}
              onToggleEnabled={handleToggleEnabled}
              projectId={adminApp.projectId}
            />
          ))}
        </div>
      </div>

      <div className="my-8 px-4">
        <h2 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">Explore more apps</h2>
        <div className="flex flex-wrap gap-4 sm:gap-6 md:gap-8 lg:gap-10 justify-start">
          {disabledApps.map((app) => (
            <AppSquare
              key={app.name}
              app={app}
              onClick={handleAppClick}
              onToggleEnabled={handleToggleEnabled}
              projectId={adminApp.projectId}
            />
          ))}
        </div>
      </div>

      <AppStoreDialog
        app={selectedApp}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onEnable={handleEnableApp}
      />
    </PageLayout>
  );
}
