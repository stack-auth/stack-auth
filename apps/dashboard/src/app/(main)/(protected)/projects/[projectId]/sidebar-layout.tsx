'use client';

import type { ReactNode } from 'react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { usePathname } from 'next/navigation';
import {
  Blocks,
  ChevronDown,
  ChevronRight,
  Globe,
  KeyRound,
  LucideIcon,
  Menu,
  Settings,
  Sparkles,
} from 'lucide-react';

import { MobileAppShell } from '@/components/mobile-app-shell';
import { Link } from '@/components/link';
import { Logo } from '@/components/logo';
import { ProjectSwitcher } from '@/components/project-switcher';
import { StackCompanion } from '@/components/stack-companion';
import ThemeToggle from '@/components/theme-toggle';
import { ALL_APPS_FRONTEND, AppFrontend, DUMMY_ORIGIN, getAppPath, getItemPath, testAppPath, testItemPath } from '@/lib/apps-frontend';
import { getPublicEnvVar } from '@/lib/env';
import { cn } from '@/lib/utils';
import { UserButton, useUser } from '@stackframe/stack';
import { ALL_APPS, type AppId } from '@stackframe/stack-shared/dist/apps/apps-config';
import { typedEntries } from '@stackframe/stack-shared/dist/utils/objects';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { getRelativePart } from '@stackframe/stack-shared/dist/utils/urls';
import { Button, Sheet, SheetContent, SheetTitle, SheetTrigger } from '@stackframe/stack-ui';

import { useAdminApp, useProjectId } from './use-admin-app';

type Crumb = { item: ReactNode; href: string };

type Item = {
  name: ReactNode;
  href: string;
  icon: LucideIcon;
  regex?: RegExp;
  type: 'item';
};

type AppSection = {
  appId: AppId;
  name: string;
  icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
  items: {
    name: string;
    href: string;
    match: (fullUrl: URL) => boolean;
  }[];
};

type BottomItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  external?: boolean;
  regex?: RegExp;
};

type BreadcrumbSource = {
  item: string;
  href: string;
};

const bottomItems: BottomItem[] = [
  {
    name: 'Explore Apps',
    href: '/apps',
    icon: Blocks,
    regex: /^\/projects\/[^\/]+\/apps(\/.*)?$/,
  },
  {
    name: 'Project Keys',
    href: '/project-keys',
    icon: KeyRound,
    regex: /^\/projects\/[^\/]+\/project-keys(\/.*)?$/,
  },
  {
    name: 'Project Settings',
    href: '/project-settings',
    icon: Settings,
    regex: /^\/projects\/[^\/]+\/project-settings$/,
  },
];

const overviewItem: Item = {
  name: 'Overview',
  href: '/',
  regex: /^\/projects\/[^\/]+\/?$/,
  icon: Globe,
  type: 'item',
};

const normalizePath = (path: string) => {
  if (!path) return '/';
  return path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path;
};

const resolveWithin = (basePath: string, href: string) => {
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const baseUrl = new URL(normalizedBase, DUMMY_ORIGIN);
  const target = href === '/' ? './' : href;
  const resolved = new URL(target, baseUrl);
  return normalizePath(getRelativePart(resolved));
};

const relativeTo = (path: string, base: string) => {
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  if (!path.startsWith(normalizedBase)) return path;
  const rest = path.slice(normalizedBase.length);
  if (!rest) return '/';
  return rest.startsWith('/') ? rest : `/${rest}`;
};

async function resolveBreadcrumbs({
  pathname,
  projectId,
  stackAdminApp,
}: {
  pathname: string;
  projectId: string;
  stackAdminApp: ReturnType<typeof useAdminApp>;
}): Promise<Crumb[]> {
  const projectBasePath = `/projects/${projectId}`;

  if (overviewItem.regex?.test(pathname)) {
    return [{
      item: overviewItem.name,
      href: resolveWithin(projectBasePath, overviewItem.href),
    }];
  }

  const bottomMatch = bottomItems.find((item) => item.regex?.test(pathname));
  if (bottomMatch) {
    return [{
      item: bottomMatch.name,
      href: bottomMatch.external
        ? bottomMatch.href
        : resolveWithin(projectBasePath, bottomMatch.href),
    }];
  }

  const currentUrl = new URL(pathname, DUMMY_ORIGIN);
  const projectRelativePart = relativeTo(pathname, projectBasePath);

  const matchedAppEntry = typedEntries(ALL_APPS).find(([appId]) => {
    const appFrontend = ALL_APPS_FRONTEND[appId];
    return testAppPath(projectId, appFrontend, currentUrl);
  });

  if (!matchedAppEntry) {
    return [];
  }

  const [matchedAppId, app] = matchedAppEntry;
  const appFrontend: AppFrontend = ALL_APPS_FRONTEND[matchedAppId];
  const appBreadcrumbsRaw = await appFrontend.getBreadcrumbItems?.(stackAdminApp, projectRelativePart);
  const appBreadcrumbs = appBreadcrumbsRaw?.length
    ? appBreadcrumbsRaw.map((crumb: BreadcrumbSource) => ({
        item: crumb.item,
        href: resolveWithin(projectBasePath, crumb.href),
      }))
    : [{
        item: app.displayName,
        href: getAppPath(projectId, appFrontend),
      }];

  const navItem = appFrontend.navigationItems.find((item) =>
    testItemPath(projectId, appFrontend, item, currentUrl),
  );

  if (!navItem) {
    return appBreadcrumbs;
  }

  const itemHref = getItemPath(projectId, appFrontend, navItem);
  const itemRelativePart = relativeTo(pathname, itemHref);
  const itemBreadcrumbsRaw = await navItem.getBreadcrumbItems?.(stackAdminApp, itemRelativePart);
  const itemBreadcrumbs = itemBreadcrumbsRaw?.length
    ? itemBreadcrumbsRaw.map((crumb: BreadcrumbSource) => ({
        item: crumb.item,
        href: resolveWithin(itemHref, crumb.href),
      }))
    : [{
        item: navItem.displayName,
        href: itemHref,
      }];

  return [...appBreadcrumbs, ...itemBreadcrumbs];
}

function NavItem({
  item,
  href,
  onClick,
  isExpanded,
  onToggle,
}: {
  item: Item | AppSection;
  href?: string;
  onClick?: () => void;
  isExpanded?: boolean;
  onToggle?: () => void;
}) {
  const pathname = usePathname();
  const isSection = 'items' in item;
  const subItemsRef = useRef<HTMLDivElement>(null);

  const IconComponent = item.icon;
  const ButtonComponent: any = isSection ? 'button' : Link;

  const isActive = 'type' in item && item.regex?.test(pathname);

  return (
    <div className={cn('transition-[margin] duration-200', isExpanded && 'my-1')}>
      <ButtonComponent
        {...(isSection ? { onClick: onToggle } : { href })}
        className={cn(
          'flex w-full items-center rounded-2xl px-4 py-2 text-left text-sm font-medium transition-colors',
          isSection
            ? 'bg-white/40 text-slate-500/80 backdrop-blur-md dark:bg-white/5 dark:text-slate-300/70'
            : isActive
              ? 'bg-slate-900 text-white shadow-[0_14px_30px_rgba(15,23,42,0.25)] dark:bg-white dark:text-slate-900'
              : 'text-slate-600 hover:bg-white/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-slate-100',
          isSection && 'cursor-default uppercase tracking-[0.18em] text-xs',
        )}
      >
        <IconComponent className={cn('mr-2 h-4 w-4', isSection && 'opacity-70')} />
        <span className={cn('flex-1', isSection && 'text-[11px] font-semibold tracking-[0.28em] uppercase')}>{item.name}</span>
        {isSection ? (
          isExpanded ? (
            <ChevronDown strokeWidth={2} className="h-4 w-4" />
          ) : (
            <ChevronRight strokeWidth={2} className="h-4 w-4" />
          )
        ) : (
          <div className="h-4" />
        )}
      </ButtonComponent>

      {isSection && (
        <div
          ref={subItemsRef}
          style={{
            height: isExpanded
              ? subItemsRef.current
                ? `${subItemsRef.current.scrollHeight}px`
                : undefined
              : '0px',
          }}
          className={cn(
            'overflow-hidden transition-[height] duration-200',
            !isExpanded && 'h-0',
          )}
        >
          {item.items.map((child) => (
            <NavSubItem key={child.href} item={child} href={child.href} onClick={onClick} />
          ))}
        </div>
      )}
    </div>
  );
}

function NavSubItem({
  item,
  href,
  onClick,
}: {
  item: AppSection['items'][number];
  href: string;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const isActive = useMemo(() => {
    try {
      return item.match(new URL(pathname, DUMMY_ORIGIN));
    } catch {
      return false;
    }
  }, [item, pathname]);

  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'ml-6 mt-1 flex items-center rounded-2xl px-4 py-2 text-sm transition-colors',
        isActive
          ? 'bg-slate-900 text-white shadow-[0_10px_20px_rgba(15,23,42,0.2)] dark:bg-white dark:text-slate-900'
          : 'text-slate-500 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-100',
      )}
    >
      <span>{item.name}</span>
    </Link>
  );
}

function SidebarContent({ projectId, onNavigate }: { projectId: string; onNavigate?: () => void }) {
  const stackAdminApp = useAdminApp();
  const pathname = usePathname();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const enabledApps = typedEntries(config.apps.installed)
    .filter(([appId, appConfig]) => appConfig?.enabled && appId in ALL_APPS)
    .map(([appId]) => appId as AppId);
  const [expandedSections, setExpandedSections] = useState<Set<AppId>>(getDefaultExpandedSections());

  const toggleSection = (appId: AppId) => {
    setExpandedSections((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(appId)) {
        newSet.delete(appId);
      } else {
        newSet.add(appId);
      }
      return newSet;
    });
  };

  function getDefaultExpandedSections(): Set<AppId> {
    for (const enabledApp of enabledApps) {
      const appFrontend = ALL_APPS_FRONTEND[enabledApp];
      if (testAppPath(projectId, appFrontend, new URL(pathname, DUMMY_ORIGIN))) {
        return new Set([enabledApp]);
      }
    }
    return new Set(['authentication']);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-white/30 bg-white/80 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/75">
        {getPublicEnvVar('NEXT_PUBLIC_STACK_EMULATOR_ENABLED') === 'true' ? (
          <div className="flex justify-center py-2">
            <Logo full width={96} />
          </div>
        ) : (
          <ProjectSwitcher currentProjectId={projectId} />
        )}
      </div>

      <div className="space-y-3">
        <NavItem
          item={overviewItem}
          href={`/projects/${projectId}${overviewItem.href}`}
          onClick={onNavigate}
        />
      </div>

      <div className="space-y-3">
        <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-500/70 dark:text-slate-300/60">
          My Apps
        </div>
        {enabledApps.map((appId) => {
          const app = ALL_APPS[appId as AppId];
          const appFrontend = ALL_APPS_FRONTEND[appId as AppId];
          return (
            <NavItem
              key={appId}
              item={{
                name: app.displayName,
                appId,
                items: appFrontend.navigationItems.map((navItem) => ({
                  name: navItem.displayName,
                  href: getItemPath(projectId, appFrontend, navItem),
                  match: (fullUrl: URL) => testItemPath(projectId, appFrontend, navItem, fullUrl),
                })),
                href: getAppPath(projectId, appFrontend),
                icon: appFrontend.icon,
              }}
              isExpanded={expandedSections.has(appId)}
              onToggle={() => toggleSection(appId)}
            />
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-500/70 dark:text-slate-300/60">
          Manage
        </div>
        {bottomItems.map((item) => (
          <NavItem
            key={item.name}
            onClick={onNavigate}
            item={{
              name: item.name,
              type: 'item',
              href: item.href,
              icon: item.icon,
              regex: item.regex,
            }}
            href={item.external ? item.href : `/projects/${projectId}${item.href}`}
          />
        ))}
      </div>
    </div>
  );
}

function BottomNavigation({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const items: (BottomItem & { type?: 'overview' })[] = [
    { name: overviewItem.name as string, href: overviewItem.href, icon: overviewItem.icon, regex: overviewItem.regex },
    ...bottomItems,
  ];

  return (
    <nav className="flex items-center gap-2 rounded-[24px] border border-white/40 bg-white/75 p-2 shadow-[0_20px_40px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/75">
      {items.map((item) => {
        const href = item.external ? item.href : `/projects/${projectId}${item.href}`;
        const active = item.regex?.test(pathname) ?? false;
        return (
          <Link
            key={item.name}
            href={href}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 rounded-[18px] px-3 py-2 text-[11px] font-medium transition-all',
              active
                ? 'bg-slate-900 text-white shadow-[0_12px_26px_rgba(15,23,42,0.22)] dark:bg-white dark:text-slate-900'
                : 'text-slate-600 hover:bg-white/65 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-slate-100',
            )}
          >
            <item.icon
              className={cn('h-4 w-4', active ? 'text-white dark:text-slate-900' : 'text-slate-500 dark:text-slate-300')}
              strokeWidth={active ? 2.4 : 2}
            />
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}

export default function SidebarLayout({ children }: { children?: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState<Crumb[]>([]);
  const { resolvedTheme, setTheme } = useTheme();
  const projectId = useProjectId();
  const pathname = usePathname();
  const stackAdminApp = useAdminApp();

  const user = useUser({ or: 'redirect', projectIdMustMatch: 'internal' });
  const projects = user.useOwnedProjects();
  const selectedProject = projects.find((project) => project.id === projectId);

  useEffect(() => {
    let cancelled = false;
    runAsynchronously(async () => {
      const items = await resolveBreadcrumbs({ pathname, projectId, stackAdminApp });
      if (!cancelled) setBreadcrumbs(items);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, projectId, stackAdminApp]);

  const headerTitle = breadcrumbs.at(-1)?.item ?? overviewItem.name;
  const headerTrail = breadcrumbs.slice(0, -1);

  const showEmulatorToggle = getPublicEnvVar('NEXT_PUBLIC_STACK_EMULATOR_ENABLED') === 'true';

  return (
    <MobileAppShell className="mobile-shell-inner--flush" footer={<BottomNavigation projectId={projectId} />}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="px-6"
          style={{ paddingTop: 'clamp(1rem, 4vw, 1.6rem)' }}
        >
          <div className="flex items-center justify-between rounded-[24px] border border-white/40 bg-white/75 px-4 py-3 shadow-[0_24px_48px_rgba(15,23,42,0.18)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/70">
            <div className="flex items-center gap-3">
              <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetTitle className="hidden">Project navigation</SheetTitle>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-2xl border border-white/60 bg-white/75 text-slate-700 shadow-[0_12px_26px_rgba(15,23,42,0.18)] transition hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-slate-200"
                  >
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  aria-describedby={undefined}
                  side="left"
                  className="w-[320px] max-w-[92vw] border-0 bg-transparent p-0"
                >
                  <div className="h-full overflow-y-auto p-4">
                    <div className="rounded-[28px] border border-white/20 bg-white/85 p-4 shadow-[0_26px_52px_rgba(15,23,42,0.2)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/80">
                      <SidebarContent projectId={projectId} onNavigate={() => setSidebarOpen(false)} />
                    </div>
                  </div>
                </SheetContent>
              </Sheet>

              <div className="flex flex-col gap-1 leading-tight">
                <span className="text-[11px] uppercase tracking-[0.28em] text-slate-500/70 dark:text-slate-300/60">
                  {selectedProject?.displayName ?? 'Project'}
                </span>
                <div className="flex flex-wrap items-center gap-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {headerTrail.map((crumb, index) => (
                    <Fragment key={`${crumb.href}-${index}`}>
                      <Link
                        href={crumb.href}
                        className="text-slate-500 transition hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                      >
                        {crumb.item}
                      </Link>
                      <span className="text-slate-400 dark:text-slate-500">/</span>
                    </Fragment>
                  ))}
                  <span>{headerTitle}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Sheet open={companionOpen} onOpenChange={setCompanionOpen}>
                <SheetTitle className="hidden">Stack Companion</SheetTitle>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full border border-white/60 bg-white/75 text-slate-700 shadow-[0_12px_26px_rgba(15,23,42,0.18)] transition hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-slate-200"
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  aria-describedby={undefined}
                  side="bottom"
                  className="h-[80vh] max-w-full border-0 bg-transparent p-0"
                >
                  <div className="mx-auto h-full w-full max-w-[520px] overflow-hidden rounded-[28px] border border-white/20 bg-white/85 p-2 shadow-[0_26px_52px_rgba(15,23,42,0.22)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/85">
                    <StackCompanion className="h-full" onExpandedChange={() => undefined} />
                  </div>
                </SheetContent>
              </Sheet>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="rounded-full border border-white/60 bg-white/75 text-slate-700 shadow-[0_12px_26px_rgba(15,23,42,0.18)] transition hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-slate-200"
              >
                <Link href={`/projects/${projectId}/project-settings`}>
                  <Settings className="h-4 w-4" />
                </Link>
              </Button>
              {showEmulatorToggle ? (
                <div className="rounded-full border border-white/50 bg-white/70 p-1 shadow-[0_10px_20px_rgba(15,23,42,0.15)] dark:border-white/10 dark:bg-white/10">
                  <ThemeToggle />
                </div>
              ) : (
                <div className="rounded-full border border-white/60 bg-white/80 p-1 shadow-[0_12px_28px_rgba(37,99,235,0.28)] transition dark:border-white/10 dark:bg-white/10">
                  <UserButton colorModeToggle={() => setTheme(resolvedTheme === 'light' ? 'dark' : 'light')} />
                </div>
              )}
            </div>
          </div>
        </div>

        <main
          className="flex-1 overflow-y-auto px-6"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 4.5rem)' }}
        >
          {children}
        </main>
      </div>
    </MobileAppShell>
  );
}
