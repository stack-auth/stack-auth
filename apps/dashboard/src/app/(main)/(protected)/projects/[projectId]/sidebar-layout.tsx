'use client';

import { Link } from "@/components/link";
import { Logo } from "@/components/logo";
import { ProjectSwitcher } from "@/components/project-switcher";
import { StackCompanion } from "@/components/stack-companion";
import ThemeToggle from "@/components/theme-toggle";
import { ALL_APPS_FRONTEND, DUMMY_ORIGIN, getAppPath, getItemPath, testAppPath, testItemPath } from "@/lib/apps-frontend";
import { getPublicEnvVar } from '@/lib/env';
import { cn } from "@/lib/utils";
import { UserButton } from "@stackframe/stack";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
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
} from "@stackframe/stack-ui";
import {
  Blocks,
  ChevronDown,
  Globe,
  KeyRound,
  LucideIcon,
  Menu,
  PanelLeft,
  Settings,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { useAdminApp, useProjectId } from "./use-admin-app";

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
  firstItemHref?: string,
};

type BottomItem = {
  name: string,
  href: string,
  icon: LucideIcon,
  external?: boolean,
  regex?: RegExp,
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
    "hover:bg-background/60",
    "text-muted-foreground hover:text-foreground"
  );

  const buttonClasses = cn(
    "group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-all duration-150 hover:transition-none",
    isHighlighted
      ? "bg-gradient-to-r from-blue-500/[0.15] to-blue-500/[0.08] text-foreground shadow-[0_0_12px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/20"
      : inactiveClasses,
    isSection ? "cursor-default" : "cursor-pointer",
    isSection && isExpanded && !isHighlighted && "bg-background/30"
  );

  const iconClasses = cn(
    "h-4 w-4 flex-shrink-0 transition-colors duration-150 group-hover:transition-none",
    isHighlighted
      ? "text-blue-600 dark:text-blue-400"
      : "text-muted-foreground group-hover:text-foreground"
  );

  const caretClasses = cn(
    "h-4 w-4 flex-shrink-0 transition-all duration-150 group-hover:transition-none",
    isHighlighted
      ? "text-blue-600 dark:text-blue-400"
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
                    ? "bg-blue-500/[0.12] shadow-[0_0_12px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/20"
                    : "hover:bg-background/60 text-muted-foreground hover:text-foreground"
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
                    ? "bg-blue-500/[0.12] shadow-[0_0_12px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/20"
                    : "hover:bg-background/60 text-muted-foreground hover:text-foreground"
                )}
              >
                <Link href={href ?? "#"} onClick={onClick} className="flex items-center justify-center">
                  <IconComponent className={iconClasses} />
                </Link>
              </Button>
            )}
          </TooltipTrigger>
          <TooltipContent side="right">
            {item.name}
          </TooltipContent>
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
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 hover:transition-none",
        isActive
          ? "bg-gradient-to-r from-blue-500/[0.15] to-blue-500/[0.08] text-foreground shadow-[0_0_12px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/20"
          : "text-muted-foreground hover:text-foreground hover:bg-background/60"
      )}
    >
      <span className="relative flex h-2 w-2 items-center justify-center">
        <span
          className={cn(
            "h-2 w-2 rounded-full transition-all duration-150 group-hover:transition-none",
            isActive
              ? "bg-blue-600 dark:bg-blue-400"
              : "bg-muted-foreground/40 group-hover:bg-blue-500/50"
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
}: {
  projectId: string,
  onNavigate?: () => void,
  isCollapsed?: boolean,
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
      <div className={cn("flex flex-grow flex-col overflow-y-auto py-4 transition-all duration-200", isCollapsed ? "px-2" : "px-3")}>
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

      <div className={cn("sticky bottom-0 border-t border-border/30 py-3 backdrop-blur-sm transition-all duration-200 rounded-b-2xl", isCollapsed ? "px-2" : "px-3")}>
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
      </div>
    </div>
  );
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
      <div className="mx-auto w-full flex flex-col min-h-screen bg-background shadow-2xl border-x border-border/5">
        {/* Header - Sticky Floating */}
        <div className="sticky top-3 z-20 mx-3 mb-3 mt-3 flex h-14 items-center justify-between bg-foreground/5 border border-foreground/5 backdrop-blur-xl px-4 shadow-sm rounded-2xl">
          {/* Left section: Toggle/Menu + Project Switcher */}
          <div className="flex items-center gap-3">
            {/* Desktop: Toggle button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleCollapsed}
              className="hidden lg:flex h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>

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
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent
                aria-describedby={undefined}
                side='left'
                className="w-[248px] bg-foreground/5 border-foreground/5 p-0 backdrop-blur-xl shadow-sm"
                hasCloseButton={false}
              >
                <SidebarContent projectId={projectId} onNavigate={() => setSidebarOpen(false)} />
              </SheetContent>
            </Sheet>

            {/* Desktop: Project Switcher */}
            <div className="hidden lg:block max-w-xs">
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

          {/* Right section: Theme toggle and User button */}
          <div className="flex gap-2 items-center">
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

        {/* Body Layout (Left Sidebar + Content + Right Companion) */}
        <div className="flex flex-1 items-start w-full">
          {/* Left Sidebar - Sticky */}
          <aside
            className={cn(
              "sticky top-20 h-[calc(100vh-6rem)] ml-3 hidden flex-col bg-foreground/5 border border-foreground/5 backdrop-blur-xl lg:flex z-[10] transition-[width] duration-200 ease-in-out rounded-2xl shadow-sm",
              isCollapsed ? "w-[64px]" : "w-[248px]"
            )}
          >
            <SidebarContent
              projectId={projectId}
              isCollapsed={isCollapsed}
            />
          </aside>

          {/* Main Content Area */}
          <main className="flex-1 min-w-0 px-2 pb-3 xl:pr-14 2xl:pr-2">
            <div className="relative flex flex-col min-h-full">
              {props.children}
            </div>
          </main>

          {/* Stack Companion -
              On 2xl+: inline split-screen that pushes content (renders inside flex)
              On xl-2xl: fixed overlay mode (renders with fixed positioning)
              The component handles its own positioning and wrapper internally
          */}
          <StackCompanion className="hidden xl:flex" />
        </div>
      </div>
    </TooltipProvider>
  );
}
