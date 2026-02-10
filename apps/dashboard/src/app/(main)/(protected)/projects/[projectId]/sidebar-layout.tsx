'use client';

import { CmdKSearch, CmdKTrigger } from "@/components/cmdk-search";
import { Link } from "@/components/link";
import { Logo } from "@/components/logo";
import { ProjectSwitcher } from "@/components/project-switcher";
import { StackCompanion } from "@/components/stack-companion";
import ThemeToggle from "@/components/theme-toggle";
import {
  Button,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Typography,
} from "@/components/ui";
import { ALL_APPS_FRONTEND, DUMMY_ORIGIN, getAppPath, getItemPath, testAppPath, testItemPath } from "@/lib/apps-frontend";
import { useUpdateConfig } from "@/lib/config-update";
import { getPublicEnvVar } from '@/lib/env';
import { cn } from "@/lib/utils";
import {
  CaretDownIcon,
  CaretRightIcon,
  CubeIcon,
  GearIcon,
  GlobeIcon,
  KeyIcon,
  ListIcon,
  SidebarIcon,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { TooltipPortal } from "@radix-ui/react-tooltip";
import { UserButton } from "@stackframe/stack";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { usePathname } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { useAdminApp, useProjectId } from "./use-admin-app";

type Item = {
  name: React.ReactNode,
  href: string,
  icon: PhosphorIcon,
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
  firstItemHref?: string,
};

type BottomItem = {
  name: string,
  href: string,
  icon: PhosphorIcon,
  external?: boolean,
  regex?: RegExp,
};

// Bottom navigation items (always visible)
const bottomItems: BottomItem[] = [
  {
    name: 'Explore Apps',
    href: '/apps',
    icon: CubeIcon,
    regex: /^\/projects\/[^\/]+\/apps(\/.*)?$/,
  },
  {
    name: 'Project Keys',
    href: '/project-keys',
    icon: KeyIcon,
    regex: /^\/projects\/[^\/]+\/project-keys(\/.*)?$/,
  },
  {
    name: 'Project Settings',
    href: '/project-settings',
    icon: GearIcon,
    regex: /^\/projects\/[^\/]+\/project-settings$/,
  },
];

// Overview item (always at top)
const overviewItem: Item = {
  name: "Overview",
  href: "/",
  regex: /^\/projects\/[^\/]+\/?$/,
  icon: GlobeIcon,
  type: 'item'
};

function NavItem({
  item,
  href,
  onClick,
  isExpanded,
  onToggle,
  isCollapsed,
  onExpandSidebar,
}: {
  item: Item | AppSection,
  href?: string,
  onClick?: () => void,
  isExpanded?: boolean,
  onToggle?: () => void,
  isCollapsed?: boolean,
  onExpandSidebar?: () => void,
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
    "hover:bg-white/55 dark:hover:bg-background/60",
    "text-muted-foreground hover:text-foreground"
  );

  const buttonClasses = cn(
    "group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-all duration-150 hover:transition-none",
    isHighlighted
      ? "bg-white/70 text-foreground shadow-sm ring-1 ring-white/60 dark:bg-transparent dark:bg-gradient-to-r dark:from-blue-500/[0.15] dark:to-blue-500/[0.08] dark:shadow-[0_0_12px_rgba(59,130,246,0.15)] dark:ring-blue-500/20"
      : inactiveClasses,
    isSection ? "cursor-default" : "cursor-pointer",
    isSection && isExpanded && !isHighlighted && "bg-white/20 dark:bg-background/30"
  );

  const iconClasses = cn(
    "h-4 w-4 flex-shrink-0 transition-colors duration-150 group-hover:transition-none",
    isHighlighted
      ? "text-indigo-700 dark:text-blue-400"
      : "text-muted-foreground group-hover:text-foreground"
  );

  const caretClasses = cn(
    "h-[13px] w-[13px] flex-shrink-0 transition-all duration-150 group-hover:transition-none",
    isHighlighted
      ? "text-indigo-700 dark:text-blue-400"
      : "text-muted-foreground group-hover:text-foreground",
    isSection && isExpanded && "rotate-180"
  );

  if (isCollapsed) {
    // For sections, navigate to the first item when collapsed
    const collapsedHref = isSection && item.firstItemHref ? item.firstItemHref : href;

    return (
      <div className="flex justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            {isSection ? (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className={cn(
                  "h-9 w-9 p-0 justify-center rounded-lg transition-all duration-150 hover:transition-none",
                  isHighlighted
                    ? "bg-white/70 shadow-sm ring-1 ring-white/60 dark:bg-blue-500/[0.12] dark:shadow-[0_0_12px_rgba(59,130,246,0.15)] dark:ring-blue-500/20"
                    : "hover:bg-white/40 dark:hover:bg-background/60 text-muted-foreground hover:text-foreground"
                )}
              >
                <Link href={collapsedHref ?? "#"} onClick={onClick}>
                  <IconComponent className={iconClasses} />
                </Link>
              </Button>
            ) : (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className={cn(
                  "h-9 w-9 p-0 justify-center rounded-lg transition-all duration-150 hover:transition-none",
                  isHighlighted
                    ? "bg-white/70 shadow-sm ring-1 ring-white/60 dark:bg-blue-500/[0.12] dark:shadow-[0_0_12px_rgba(59,130,246,0.15)] dark:ring-blue-500/20"
                    : "hover:bg-white/40 dark:hover:bg-background/60 text-muted-foreground hover:text-foreground"
                )}
              >
                <Link href={href ?? "#"} onClick={onClick} className="flex items-center justify-center">
                  <IconComponent className={iconClasses} />
                </Link>
              </Button>
            )}
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent side="right" className="!z-[9999]">
              {item.name}
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      </div>
    );
  }

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
          <CaretDownIcon weight="bold" className={caretClasses} />
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
            "ml-[0.5px] w-[calc(100%-1px)] transition-[height] duration-200",
            !isExpanded && "h-0 overflow-hidden"
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
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 hover:transition-none",
        isActive
          ? "bg-white/70 text-foreground shadow-sm ring-1 ring-white/60 dark:bg-transparent dark:bg-gradient-to-r dark:from-blue-500/[0.15] dark:to-blue-500/[0.08] dark:shadow-[0_0_12px_rgba(59,130,246,0.15)] dark:ring-blue-500/20"
          : "text-muted-foreground hover:text-foreground hover:bg-white/40 dark:hover:bg-background/60"
      )}
    >
      <span className="relative flex h-2 w-2 items-center justify-center">
        <span
          className={cn(
            "h-2 w-2 rounded-full transition-all duration-150 group-hover:transition-none",
            isActive
              ? "bg-indigo-700 dark:bg-blue-400"
              : "bg-muted-foreground/40 group-hover:bg-indigo-500/50 dark:group-hover:bg-blue-500/50"
          )}
        />
      </span>
      <span className="truncate leading-none">{item.name}</span>
    </Link>
  );
}

// Memoized component for app navigation items to prevent unnecessary re-renders
function AppNavItem({
  appId,
  projectId,
  isExpanded,
  onToggle,
  isCollapsed,
  onExpandSidebar,
  onClick,
}: {
  appId: AppId,
  projectId: string,
  isExpanded: boolean,
  onToggle: () => void,
  isCollapsed?: boolean,
  onExpandSidebar?: () => void,
  onClick?: () => void,
}) {
  const app = ALL_APPS[appId];
  const appFrontend = ALL_APPS_FRONTEND[appId];

  // Memoize the item object to prevent NavItem re-renders
  const navItemData = useMemo(() => {
    const items = appFrontend.navigationItems.map((navItem) => ({
      name: navItem.displayName,
      href: getItemPath(projectId, appFrontend, navItem),
      match: (fullUrl: URL) => testItemPath(projectId, appFrontend, navItem, fullUrl),
    }));
    return {
      name: app.displayName,
      appId,
      items,
      href: getAppPath(projectId, appFrontend),
      icon: appFrontend.icon,
      firstItemHref: items[0]?.href,
    };
  }, [app.displayName, appId, appFrontend, projectId]);

  return (
    <NavItem
      item={navItemData}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isCollapsed={isCollapsed}
      onExpandSidebar={onExpandSidebar}
      onClick={onClick}
    />
  );
}

function SidebarContent({
  projectId,
  onNavigate,
  isCollapsed,
  onToggleCollapse,
}: {
  projectId: string,
  onNavigate?: () => void,
  isCollapsed?: boolean,
  onToggleCollapse?: () => void,
}) {
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
      if (!(appFrontend as any)) {
        continue;
      }
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
      <div
        className={cn("flex flex-grow flex-col overflow-y-auto py-4 transition-all duration-200", isCollapsed ? "px-2" : "px-3")}
        style={{
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 24px, black calc(100% - 24px), transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 24px, black calc(100% - 24px), transparent 100%)',
        }}
      >
        <div className="space-y-3">
          <NavItem
            item={overviewItem}
            onClick={onNavigate}
            href={`/projects/${projectId}${overviewItem.href}`}
            isCollapsed={isCollapsed}
          />
        </div>

        <div className={cn("mt-6 mb-3 transition-opacity duration-200", isCollapsed ? "opacity-0 h-0 mt-2 mb-0 overflow-hidden" : "opacity-100")}>
          <Typography className="px-1 text-xs font-semibold uppercase tracking-wide text-foreground/70">
            My Apps
          </Typography>
        </div>

        <div className={cn("space-y-2", isCollapsed && "mt-2")}>
          {enabledApps.map((appId) => (
            <AppNavItem
              key={appId}
              appId={appId}
              projectId={projectId}
              isExpanded={expandedSections.has(appId)}
              onToggle={() => toggleSection(appId)}
              isCollapsed={isCollapsed}
              onClick={onNavigate}
            />
          ))}
        </div>

        <div className="flex-grow" />
      </div>

      <div className={cn("sticky bottom-0 border-t border-black/[0.06] dark:border-foreground/10 py-3 transition-all duration-200 dark:backdrop-blur-xl dark:rounded-b-2xl", isCollapsed ? "px-2" : "px-3")}>
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
              isCollapsed={isCollapsed}
            />
          ))}
        </div>

        {/* User button and collapse toggle */}
        <div className={cn(
          "mt-4 pt-3 border-t border-border/30 flex items-center gap-2 min-w-0",
          isCollapsed ? "justify-center" : "justify-between"
        )}>
          {!isCollapsed && (
            <div className="min-w-0 flex-1 overflow-hidden max-w-[calc(100%-3rem)]">
              <div className="w-full min-w-0 [&_button]:min-w-0 [&_button]:w-full [&_button]:max-w-full">
                <UserButton showUserInfo />
              </div>
            </div>
          )}
          {onToggleCollapse && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleCollapse}
                  className="h-8 w-8 p-1 flex-shrink-0 text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-lg transition-all duration-150 hover:transition-none"
                >
                  <SidebarIcon className={cn("h-4 w-4 transition-transform duration-200", isCollapsed && "rotate-180")} />
                </Button>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent side="right" className="!z-[9999]">
                  {isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                </TooltipContent>
              </TooltipPortal>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

function SpotlightSearchWrapper({ projectId }: { projectId: string }) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  const enabledApps = useMemo(() =>
    typedEntries(config.apps.installed)
      .filter(([appId, appConfig]) => appConfig?.enabled && appId in ALL_APPS)
      .map(([appId]) => appId as AppId),
    [config.apps.installed]
  );

  const handleEnableApp = useCallback(async (appId: AppId) => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: { [`apps.installed.${appId}.enabled`]: true },
      pushable: true,
    });
  }, [stackAdminApp, updateConfig]);

  return <CmdKSearch projectId={projectId} enabledApps={enabledApps} onEnableApp={handleEnableApp} />;
}

export default function SidebarLayout(props: { children?: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const projectId = useProjectId();

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  return (
    <TooltipProvider>
      <div className="mx-auto w-full flex flex-col min-h-screen dark:bg-background dark:shadow-2xl dark:border-x dark:border-border/5">
        {/* Header - Glassmorphic with vertical blur gradient (light) / Floating card (dark) */}
        <div className="sticky top-0 z-20 relative dark:top-3 dark:mx-3 dark:mb-3 dark:mt-3 dark:rounded-2xl">
          {/* Vertical blur layer behind header - light mode only */}
          <div
            className="absolute inset-0 h-[calc(100%+1.5rem)] pointer-events-none dark:hidden"
            style={{
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)',
            }}
          />
          <div className="relative flex h-14 items-center justify-between px-5 dark:bg-foreground/5 dark:px-4 dark:border dark:border-foreground/5 dark:backdrop-blur-2xl dark:shadow-sm dark:rounded-2xl">
            {/* Left section: Logo + Menu + Project Switcher */}
            <div className="flex grow-1 items-center gap-2">
              {/* Mobile: Menu button */}
              <Sheet onOpenChange={(open) => setSidebarOpen(open)} open={sidebarOpen}>
                <SheetTitle className="hidden">
                  Sidebar Menu
                </SheetTitle>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="lg:hidden h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
                  >
                    <ListIcon className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  aria-describedby={undefined}
                  side='left'
                  className="w-[248px] bg-white/90 dark:bg-foreground/5 border-black/[0.06] dark:border-foreground/5 p-0 backdrop-blur-sm shadow-md"
                  hasCloseButton={false}
                >
                  <SidebarContent projectId={projectId} onNavigate={() => setSidebarOpen(false)} />
                </SheetContent>
              </Sheet>

              {/* Desktop: Logo + Breadcrumb + Project Switcher */}
              <div className="hidden lg:flex items-center gap-2">
                <Logo height={24} href="/" />
                <CaretRightIcon className="h-4 w-4 text-muted-foreground/50" />
                {getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_ENABLED") === "true" ? (
                  <Logo full width={96} href="/projects" />
                ) : (
                  <ProjectSwitcher currentProjectId={projectId} />
                )}
              </div>

              {/* Mobile: Logo */}
              <div className="lg:hidden">
                <Logo full height={24} href="/projects" />
              </div>
            </div>

            {/* Middle section: Control Center (development only) */}
            {process.env.NODE_ENV === "development" && (
              <div className="grow-1">
                <CmdKTrigger />
              </div>
            )}

            {/* Right section: Search, Theme toggle and User button */}
            <div className="flex grow-1 gap-2 items-center">
              {getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_ENABLED") === "true" ? (
                <ThemeToggle />
              ) : (
                <>
                  <ThemeToggle />
                  <UserButton />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Spotlight Search (development only) */}
        {process.env.NODE_ENV === "development" && (
          <SpotlightSearchWrapper projectId={projectId} />
        )}

        {/* Body Layout (Left Sidebar + Content + Right Companion) */}
        <div className="relative flex flex-1 items-start w-full">
          {/* Left Sidebar - Sticky */}
          <aside
            className={cn(
              "sticky top-14 h-[calc(100vh-3.5rem)] hidden flex-col lg:flex z-[10] transition-[width] duration-200 ease-in-out dark:top-20 dark:h-[calc(100vh-6rem)] dark:ml-3 dark:bg-foreground/5 dark:border dark:border-foreground/5 dark:backdrop-blur-2xl dark:rounded-2xl dark:shadow-sm",
              isCollapsed ? "w-[64px]" : "w-[248px]"
            )}
          >
            <SidebarContent
              projectId={projectId}
              isCollapsed={isCollapsed}
              onToggleCollapse={toggleCollapsed}
            />
          </aside>

          {/* Main Content Area */}
          <main className="flex-1 min-w-0 pt-1 pb-3 pr-3 dark:py-0 dark:px-2 dark:pb-3 dark:h-[calc(100vh-6rem)]">
            <div className="relative flex flex-col min-h-[calc(100vh-4.5rem)] bg-white/80 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.06),0_1px_4px_rgba(0,0,0,0.04)] rounded-2xl border border-black/[0.06] lg:pr-20 dark:min-h-0 dark:h-full dark:overflow-auto dark:bg-transparent dark:backdrop-blur-none dark:shadow-none dark:rounded-none dark:border-0 dark:pr-0">
              {props.children}
            </div>
          </main>

          {/* Stack Companion - absolute overlay in light mode, normal flow in dark mode */}
          <div className="pointer-events-none absolute top-0 right-2 bottom-0 z-30 hidden lg:block dark:pointer-events-auto dark:relative dark:inset-auto dark:right-auto dark:z-auto dark:shrink-0">
            <StackCompanion className="pointer-events-auto" />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
