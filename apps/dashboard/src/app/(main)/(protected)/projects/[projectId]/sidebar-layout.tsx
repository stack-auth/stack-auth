'use client';

import { Link } from "@/components/link";
import { Logo } from "@/components/logo";
import { ProjectSwitcher } from "@/components/project-switcher";
import { StackCompanion } from "@/components/stack-companion";
import ThemeToggle from "@/components/theme-toggle";
import { ALL_APPS_FRONTEND, AppFrontend, DUMMY_ORIGIN, getAppPath, getItemPath, testAppPath, testItemPath } from "@/lib/apps-frontend";
import { getPublicEnvVar } from '@/lib/env';
import { cn } from "@/lib/utils";
import { UserButton, useUser } from "@stackframe/stack";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { getRelativePart } from "@stackframe/stack-shared/dist/utils/urls";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Typography,
} from "@stackframe/stack-ui";
import {
  Blocks,
  ChevronDown,
  ChevronRight,
  Globe,
  KeyRound,
  LucideIcon,
  Menu,
  Settings,
} from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminApp, useProjectId } from "./use-admin-app";

type BreadcrumbItem = { item: React.ReactNode, href: string };

type Item = {
  name: React.ReactNode,
  href: string,
  icon: LucideIcon,
  regex?: RegExp,
  type: 'item',
};

type AppSection = {
  appId: AppId,
  name: string,
  icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>>,
  items: {
    name: string,
    href: string,
    match: (fullUrl: URL) => boolean,
  }[],
};

type BottomItem = {
  name: string,
  href: string,
  icon: LucideIcon,
  external?: boolean,
  regex?: RegExp,
};

type BreadcrumbSource = {
  item: string,
  href: string,
};

// Bottom navigation items (always visible)
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

// Overview item (always at top)
const overviewItem: Item = {
  name: "Overview",
  href: "/",
  regex: /^\/projects\/[^\/]+\/?$/,
  icon: Globe,
  type: 'item'
};

const normalizePath = (path: string) => {
  if (!path) return "/";
  return path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
};

const resolveWithin = (basePath: string, href: string) => {
  const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const baseUrl = new URL(normalizedBase, DUMMY_ORIGIN);
  const target = href === "/" ? "./" : href;
  const resolved = new URL(target, baseUrl);
  return normalizePath(getRelativePart(resolved));
};

const relativeTo = (path: string, base: string) => {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  if (!path.startsWith(normalizedBase)) return path;
  const rest = path.slice(normalizedBase.length);
  if (!rest) return "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
};

async function resolveBreadcrumbs({
  pathname,
  projectId,
  stackAdminApp,
}: {
  pathname: string,
  projectId: string,
  stackAdminApp: ReturnType<typeof useAdminApp>,
}): Promise<BreadcrumbItem[]> {
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
    testItemPath(projectId, appFrontend, item, currentUrl)
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
  item: Item | AppSection,
  href?: string,
  onClick?: () => void,
  isExpanded?: boolean,
  onToggle?: () => void,
}) {
  const pathname = usePathname();
  const isSection = 'items' in item;
  const subItemsRef = useRef<HTMLDivElement>(null);
  const currentUrl = useMemo(() => {
    try {
      return new URL(pathname, DUMMY_ORIGIN);
    } catch {
      return null;
    }
  }, [pathname]);

  // If this is a collapsible section
  const IconComponent = item.icon;
  const isDirectItemActive = "type" in item && item.regex?.test(pathname);

  const matchesCurrentUrl = (sectionItem: AppSection["items"][number]) => {
    if (!currentUrl) {
      return false;
    }
    try {
      return sectionItem.match(currentUrl);
    } catch {
      return false;
    }
  };

  const isSectionActive = isSection
    ? item.items.some((sectionItem) => matchesCurrentUrl(sectionItem))
    : false;

  const isHighlighted = isDirectItemActive || isSectionActive;

  const inactiveClasses = cn(
    "border-transparent hover:border-blue-500/20 hover:bg-blue-500/5",
    "text-foreground"
  );

  const buttonClasses = cn(
    "group flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-medium transition-all",
    isHighlighted
      ? "border-blue-500/40 bg-blue-500/10 text-foreground shadow-sm dark:text-foreground"
      : inactiveClasses,
    isSection ? "cursor-default" : "cursor-pointer",
    isSection && isExpanded && !isHighlighted && "border-border/60 bg-muted/20"
  );

  const iconClasses = cn(
    "h-4 w-4 flex-shrink-0 transition-colors",
    isHighlighted
      ? "text-blue-600 dark:text-blue-400"
      : "text-muted-foreground group-hover:text-foreground"
  );

  const caretClasses = cn(
    "h-4 w-4 flex-shrink-0 transition-colors transition-transform",
    isHighlighted
      ? "text-blue-600 dark:text-blue-400"
      : "text-muted-foreground group-hover:text-foreground",
    isSection && isExpanded && "rotate-180"
  );

  return (
    <div className="transition-[margin] duration-200">
      {isSection ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className={buttonClasses}
        >
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <IconComponent className={iconClasses} />
            <span className="truncate text-sm font-semibold">{item.name}</span>
          </span>
          <ChevronDown strokeWidth={2} className={caretClasses} />
        </Button>
      ) : (
        <Button
          asChild
          variant="ghost"
          size="sm"
          className={buttonClasses}
        >
          <Link href={href ?? "#"} onClick={onClick} className="flex w-full items-center gap-3">
            <IconComponent className={iconClasses} />
            <span className="flex-1 truncate text-sm">{item.name}</span>
            <ChevronRight
              strokeWidth={2}
              className={cn(
                "h-4 w-4 flex-shrink-0 transition-all",
                isHighlighted
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-muted-foreground group-hover:text-foreground"
              )}
            />
          </Link>
        </Button>
      )}

      {isSection && (
        <div
          ref={subItemsRef}
          style={{
            height: isExpanded
              ? subItemsRef.current
                ? `${subItemsRef.current.scrollHeight}px`
                : undefined
              : "0px",
          }}
          className={cn(
            "ml-[0.5px] w-[calc(100%-1px)] overflow-hidden transition-[height] duration-200",
            !isExpanded && "h-0"
          )}
        >
          <div className="space-y-2 py-2 pl-3">
            {item.items.map((navItem) => (
              <NavSubItem key={navItem.href} item={navItem} href={navItem.href} onClick={onClick} />
            ))}
          </div>
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
  item: AppSection["items"][number],
  href: string,
  onClick?: () => void,
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
        "group flex items-center gap-3 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
        isActive
          ? "border-blue-500/40 bg-blue-500/10 text-foreground shadow-sm dark:text-foreground"
          : "border-transparent text-foreground hover:border-blue-500/20 hover:bg-blue-500/5"
      )}
    >
      <span className="relative flex h-2 w-2 items-center justify-center">
        <span
          className={cn(
            "h-2 w-2 rounded-full border transition-all",
            isActive
              ? "border-blue-500/60 bg-blue-500/40 dark:border-blue-400/60 dark:bg-blue-400/40"
              : "border-border/60 bg-muted group-hover:border-blue-500/40 group-hover:bg-blue-500/20"
          )}
        />
      </span>
      <span className="truncate leading-none">{item.name}</span>
    </Link>
  );
}

function SidebarContent({ projectId, onNavigate }: { projectId: string, onNavigate?: () => void }) {
  const stackAdminApp = useAdminApp();
  const pathname = usePathname();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();

  // Memoize enabledApps to prevent recalculation on every render
  const enabledApps = useMemo(() =>
    typedEntries(config.apps.installed)
      .filter(([appId, appConfig]) => appConfig?.enabled && appId in ALL_APPS)
      .map(([appId]) => appId as AppId),
    [config.apps.installed]
  );

  // Memoize getDefaultExpandedSections to prevent recreating the function
  const getDefaultExpandedSections = useCallback((): Set<AppId> => {
    const currentUrl = new URL(pathname, DUMMY_ORIGIN);
    for (const enabledApp of enabledApps) {
      const appFrontend = ALL_APPS_FRONTEND[enabledApp];
      if (testAppPath(projectId, appFrontend, currentUrl)) {
        return new Set([enabledApp]);
      }
    }
    return new Set(["authentication"]);
  }, [enabledApps, pathname, projectId]);

  const [expandedSections, setExpandedSections] = useState<Set<AppId>>(() => getDefaultExpandedSections());

  const toggleSection = useCallback((appId: AppId) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(appId)) {
        newSet.delete(appId);
      } else {
        newSet.add(appId);
      }
      return newSet;
    });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
        {getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_ENABLED") === "true" ? (
          <div className="mx-2 flex-grow">
            <Logo full width={96} />
          </div>
        ) : (
          <ProjectSwitcher currentProjectId={projectId} />
        )}
      </div>
      <div className="flex flex-grow flex-col overflow-y-auto px-3 py-4">
        <div className="space-y-3">
          <NavItem item={overviewItem} onClick={onNavigate} href={`/projects/${projectId}${overviewItem.href}`} />
        </div>

        <div className="mt-6 mb-3">
          <Typography className="px-1 text-xs font-semibold uppercase tracking-wide text-foreground/70">
            My Apps
          </Typography>
        </div>

        <div className="space-y-2">
          {enabledApps.map((appId) => {
            const app = ALL_APPS[appId as AppId];
            const appFrontend = ALL_APPS_FRONTEND[appId as AppId];
            // Memoize the item object to prevent NavItem re-renders
            const navItemData = {
              name: app.displayName,
              appId,
              items: appFrontend.navigationItems.map((navItem) => ({
                name: navItem.displayName,
                href: getItemPath(projectId, appFrontend, navItem),
                match: (fullUrl: URL) => testItemPath(projectId, appFrontend, navItem, fullUrl),
              })),
              href: getAppPath(projectId, appFrontend),
              icon: appFrontend.icon,
            };
            return (
              <NavItem
                key={appId}
                item={navItemData}
                isExpanded={expandedSections.has(appId)}
                onToggle={() => toggleSection(appId)}
              />
            );
          })}
        </div>

        <div className="flex-grow" />
      </div>

      <div className="sticky bottom-0 border-t border-border px-3 py-4 backdrop-blur-sm">
        <div className="space-y-2">
          {bottomItems.map((item) => (
            <NavItem
              key={item.name}
              onClick={onNavigate}
              item={{
                name: item.name,
                type: "item",
                href: item.href,
                icon: item.icon,
                regex: item.regex,
              }}
              href={item.external ? item.href : `/projects/${projectId}${item.href}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function HeaderBreadcrumb({
  mobile,
  projectId
}: {
  projectId: string,
  mobile?: boolean,
}) {
  const pathname = usePathname();
  const stackAdminApp = useAdminApp();

  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });
  const projects = user.useOwnedProjects();
  const [breadcrumbItems, setBreadcrumbItems] = useState<BreadcrumbItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    runAsynchronously(async () => {
      const items = await resolveBreadcrumbs({ pathname, projectId, stackAdminApp });
      if (!cancelled) setBreadcrumbItems(items);
    });

    return () => {
      cancelled = true;
    };
    // Only depend on pathname and projectId, stackAdminApp should be stable
  }, [pathname, projectId, stackAdminApp]);

  // Memoize selectedProject to prevent recalculation
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projects, projectId]
  );

  if (mobile) {
    return (
      <Logo full height={24} href="/projects" />
    );
  } else {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          {getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_ENABLED") !== "true" &&
            <>
              <BreadcrumbItem>
                <Link href="/projects">Home</Link>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <span className="max-w-40 truncate">
                  <Link href={`/projects/${projectId}`}>{selectedProject?.displayName}</Link>
                </span>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </>}

          {breadcrumbItems.map((name, index) => (
            index < breadcrumbItems.length - 1 ?
              <Fragment key={index}>
                <BreadcrumbItem>
                  <Link href={name.href}>
                    {name.item}
                  </Link>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </Fragment> :
              <BreadcrumbPage key={index}>
                <Link href={name.href}>
                  {name.item}
                </Link>
              </BreadcrumbPage>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    );
  }
}

export default function SidebarLayout(props: { children?: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [companionExpanded, setCompanionExpanded] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const projectId = useProjectId();

  return (
    <div className="w-full flex">
      {/* Left Sidebar */}
      <div className="fixed left-0 top-0 hidden h-screen min-w-[248px] flex-col border-r border-border bg-background lg:flex z-[10]">
        {/*
          If we put a backdrop blur on the sidebar div, it will create a new backdrop root,
          which would then make us unable to properly do a nested blur for the bottom elements
          of the sidebar. By putting the backdrop, and with it the backdrop root, in an element
          right behind all the contents, we get the same behavior but better.

          https://drafts.fxtf.org/filter-effects-2/#BackdropRoot
        */}
        <div className="absolute inset-0 backdrop-blur-sm z-[-1]"></div>

        <SidebarContent projectId={projectId} />
      </div>

      {/* Main Content Area */}
      <div className="flex flex-col flex-grow w-0 lg:ml-[248px] sm:pr-12">
        {/* Header */}
        <div className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-background px-4 backdrop-blur-sm lg:px-6">
          <div className="hidden lg:flex">
            <HeaderBreadcrumb projectId={projectId} />
          </div>

          <div className="flex lg:hidden items-center">
            <Sheet onOpenChange={(open) => setSidebarOpen(open)} open={sidebarOpen}>
              <SheetTitle className="hidden">
                Sidebar Menu
              </SheetTitle>
              <SheetTrigger>
                <Menu />
              </SheetTrigger>
              <SheetContent
                aria-describedby={undefined}
                side='left' className="w-[248px] bg-background p-0 backdrop-blur-sm" hasCloseButton={false}>
                <SidebarContent projectId={projectId} onNavigate={() => setSidebarOpen(false)} />
              </SheetContent>
            </Sheet>

            <div className="ml-4 flex lg:hidden">
              <HeaderBreadcrumb projectId={projectId} mobile />
            </div>
          </div>

          <div className="flex gap-2 relative items-center">
            <Button asChild variant="ghost" size="icon" className="hidden lg:flex">
              <Link href={`/projects/${projectId}/project-settings`}>
                <Settings className="w-4 h-4" />
              </Link>
            </Button>
            {getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_ENABLED") === "true" ?
              <ThemeToggle /> :
              <UserButton colorModeToggle={() => setTheme(resolvedTheme === 'light' ? 'dark' : 'light')} />
            }
          </div>
        </div>

        {/* Content Body - Normal scrolling */}
        <div className="flex-grow relative flex flex-col">
          {props.children}
        </div>
      </div>

      {/* Stack Companion - Fixed positioned like left sidebar */}
      <div className="fixed right-0 top-0 hidden h-screen border-l border-border bg-background sm:block z-[10]">
        <StackCompanion onExpandedChange={setCompanionExpanded} />
      </div>
    </div>
  );
}
