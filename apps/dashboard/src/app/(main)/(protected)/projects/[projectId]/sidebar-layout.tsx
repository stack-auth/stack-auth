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
  BreadcrumbSeparator, Button, Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger
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
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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

  // If this is a collapsible section
  const IconComponent = item.icon;
  const ButtonComponent: any = isSection ? "button" : Link;

  const isActive = "type" in item && item.regex?.test(pathname);

  return (
    <div className={cn(
      "transition-[margin] duration-200",
      isExpanded && "my-1",
    )}>
      <ButtonComponent
        {...(isSection ? { onClick: onToggle } : { href })}
        className={cn(
          "flex items-center w-full py-1.5 px-4 text-left hover:bg-foreground/5",
          isActive && "bg-foreground/5",
          isSection && "cursor-default"
        )}
      >
        <IconComponent className="mr-2 h-4 w-4" />
        <span className="flex-1 text-md">{item.name}</span>
        {isSection ? (
          isExpanded ? (
            <ChevronDown strokeWidth={2} className="h-4 w-4" />
          ) : (
            <ChevronRight strokeWidth={2} className="h-4 w-4" />
          )
        ) : (
          <div className=" h-4" />
        )}
      </ButtonComponent>

      {isSection && (
        <div
          ref={subItemsRef}
          style={{
            height: isExpanded ? (subItemsRef.current ? subItemsRef.current.scrollHeight + 'px' : undefined) : '0px',
          }}
          className={cn(
            "transition-[height] duration-200 overflow-hidden max-h-[999999px]",
            !isExpanded && "h-0",  // hidden, but still rendered, so we correctly prefetch the pages
          )}
        >
          {item.items.map((item) => (
            <NavSubItem key={item.href} item={item} href={item.href} onClick={onClick} />
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
        "flex items-center pl-10 pr-2 py-1 text-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        isActive && "bg-foreground/5 text-foreground"
      )}
    >
      <span>{item.name}</span>
    </Link>
  );
}

function SidebarContent({ projectId, onNavigate }: { projectId: string, onNavigate?: () => void }) {
  const stackAdminApp = useAdminApp();
  const pathname = usePathname();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const enabledApps = typedEntries(config.apps.installed).filter(([appId, appConfig]) => appConfig?.enabled && appId in ALL_APPS).map(([appId]) => appId as AppId);
  const [expandedSections, setExpandedSections] = useState<Set<AppId>>(getDefaultExpandedSections());

  const toggleSection = (appId: AppId) => {
    setExpandedSections(prev => {
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
    return new Set(["authentication"]);
  };

  return (
    <div className="flex flex-col h-full items-stretch">
      <div className="h-14 border-b flex items-center px-2 shrink-0">
        {getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_ENABLED") === "true" ? (
          <div className="flex-grow mx-2">
            <Logo full width={80} />
          </div>
        ) : (
          <ProjectSwitcher currentProjectId={projectId} />
        )}
      </div>
      <div className="flex flex-grow flex-col pt-2 overflow-y-auto">
        {/* Overview - always at top */}
        <NavItem item={overviewItem} onClick={onNavigate} href={`/projects/${projectId}${overviewItem.href}`} />


        <div className="mt-4 text-xs uppercase text-muted-foreground px-2 py-1 flex justify-start items-center gap-2">
          My Apps
        </div>
        {/* App Sections */}
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

        <div className="flex-grow" />

        {/* Bottom Items */}
        <div className="py-2 mt-2 border-t sticky bottom-0 backdrop-blur-md bg-background/20">
          {bottomItems.map((item, i) => (
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
  }, [pathname, projectId, stackAdminApp]);

  const selectedProject = projects.find((project) => project.id === projectId);

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
      <div className="flex-col border-r min-w-[240px] h-screen sticky top-0 hidden lg:flex bg-slate-200/20 dark:bg-black/20 z-[10] relative">
        {/*
          If we put a backdrop blur on the sidebar div, it will create a new backdrop root,
          which would then make us unable to properly do a nested blur for the bottom elements
          of the sidebar. By putting the backdrop, and with it the backdrop root, in an element
          right behind all the contents, we get the same behavior but better.

          https://drafts.fxtf.org/filter-effects-2/#BackdropRoot
        */}
        <div className="absolute inset-0 backdrop-blur-md z-[-1]"></div>

        <SidebarContent projectId={projectId} />
      </div>

      {/* Main Content Area */}
      <div className="flex flex-col flex-grow w-0">
        {/* Header */}
        <div className="h-14 border-b flex items-center justify-between sticky top-0 backdrop-blur-md bg-slate-200/20 dark:bg-black/20 z-10 px-4 lg:px-6">
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
                side='left' className="w-[240px] p-0" hasCloseButton={false}>
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

      {/* Stack Companion - Sticky positioned like left sidebar */}
      <div className="hidden sm:block h-screen sticky top-0 backdrop-blur-md bg-slate-200/20 dark:bg-black/20 z-[10]">
        <StackCompanion onExpandedChange={setCompanionExpanded} />
      </div>
    </div>
  );
}
