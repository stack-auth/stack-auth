'use client';

import { Link } from "@/components/link";
import { Logo } from "@/components/logo";
import { ProjectSwitcher } from "@/components/project-switcher";
import { StackCompanion } from "@/components/stack-companion";
import ThemeToggle from "@/components/theme-toggle";
import { getPublicEnvVar } from '@/lib/env';
import { cn } from "@/lib/utils";
// import { UserButton, useUser } from "@stackframe/stack";
import { useRouter } from "@/components/router";
import { UserButton } from "@stackframe/stack";
import type { AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { useHover } from "@stackframe/stack-shared/dist/hooks/use-hover";
import { getOrUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger
} from "@stackframe/stack-ui";
import {
  Blocks,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Database,
  FilePen,
  Globe,
  LayoutTemplate,
  LockKeyhole,
  LucideIcon,
  Mail,
  Menu,
  Palette,
  Receipt,
  Settings,
  Settings2,
  ShieldEllipsis,
  User,
  Users,
  Webhook,
  Workflow
} from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { Fragment, useMemo, useRef, useState } from "react";
import { useAdminApp } from "./use-admin-app";

type BreadcrumbItem = { item: React.ReactNode, href: string };

type Label = {
  name: React.ReactNode,
  type: 'label',
  requiresDevFeatureFlag?: boolean,
};

type Item = {
  name: React.ReactNode,
  href: string,
  icon: LucideIcon,
  regex: RegExp,
  type: 'item',
  requiresDevFeatureFlag?: boolean,
};

type Hidden = {
  name: BreadcrumbItem[] | ((pathname: string) => BreadcrumbItem[]),
  regex: RegExp,
  type: 'hidden',
};

type AppSection = {
  appId: AppId,
  name: string,
  icon: LucideIcon,
  items: {
    name: string,
    href: string,
    icon?: LucideIcon,
    regex: RegExp,
  }[],
};

type BottomItem = {
  name: string,
  href: string,
  icon: LucideIcon,
  regex: RegExp,
  external?: boolean,
};

// App-based navigation structure
const appSections: AppSection[] = [
  {
    appId: 'authentication',
    name: 'Authentication',
    icon: ShieldEllipsis,
    items: [
      { name: 'Users', href: '/users', icon: User, regex: /^\/projects\/[^\/]+\/users$/ },
      { name: 'Auth Methods', href: '/auth-methods', icon: ShieldEllipsis, regex: /^\/projects\/[^\/]+\/auth-methods$/ },
      { name: 'Project Permissions', href: '/project-permissions', icon: LockKeyhole, regex: /^\/projects\/[^\/]+\/project-permissions$/ },
    ]
  },
  {
    appId: 'teams',
    name: 'Teams',
    icon: Users,
    items: [
      { name: 'Teams', href: '/teams', icon: Users, regex: /^\/projects\/[^\/]+\/teams$/ },
      { name: 'Team Permissions', href: '/team-permissions', icon: LockKeyhole, regex: /^\/projects\/[^\/]+\/team-permissions$/ },
      { name: 'Team Settings', href: '/team-settings', icon: Settings2, regex: /^\/projects\/[^\/]+\/team-settings$/ },
    ]
  },
  {
    appId: 'emails',
    name: 'Emails',
    icon: Mail,
    items: [
      { name: 'Emails', href: '/emails', icon: Mail, regex: /^\/projects\/[^\/]+\/emails$/ },
      { name: 'Drafts', href: '/email-drafts', icon: FilePen, regex: /^\/projects\/[^\/]+\/email-drafts$/ },
      { name: 'Templates', href: '/email-templates', icon: LayoutTemplate, regex: /^\/projects\/[^\/]+\/email-templates$/ },
      { name: 'Themes', href: '/email-themes', icon: Palette, regex: /^\/projects\/[^\/]+\/email-themes$/ },
    ]
  },
  {
    appId: 'payments',
    name: 'Payments',
    icon: CreditCard,
    items: [
      { name: 'Offers', href: '/payments/offers', icon: CreditCard, regex: /^\/projects\/[^\/]+\/payments\/offers$/ },
      { name: 'Transactions', href: '/payments/transactions', icon: Receipt, regex: /^\/projects\/[^\/]+\/payments\/transactions$/ },
    ]
  },
  {
    appId: 'data-vault',
    name: 'Data Vault',
    icon: Database,
    items: [
      { name: 'Stores', href: '/data-vault/stores', icon: Database, regex: /^\/projects\/[^\/]+\/data-vault\/stores$/ },
    ]
  },
  {
    appId: 'workflows',
    name: 'Workflows',
    icon: Workflow,
    items: [
      { name: 'Workflows', href: '/workflows', icon: Workflow, regex: /^\/projects\/[^\/]+\/workflows$/ },
    ]
  },
  {
    appId: 'webhooks',
    name: 'Webhooks',
    icon: Webhook,
    items: [
      { name: 'Webhooks', href: '/webhooks', icon: Webhook, regex: /^\/projects\/[^\/]+\/webhooks$/ },
    ]
  },
];

// Bottom navigation items (always visible)
const bottomItems: BottomItem[] = [
  {
    name: 'Explore Apps',
    href: '/apps',
    icon: Blocks,
    regex: /^\/projects\/[^\/]+\/apps$/,
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

// Hidden breadcrumb items (for dynamic routes)
const hiddenBreadcrumbItems: Hidden[] = [
  {
    name: (pathname: string) => {
      const match = pathname.match(/^\/projects\/[^\/]+\/users\/([^\/]+)$/);
      let item;
      let href;
      if (match) {
        item = <UserBreadcrumbItem key='user-display-name' userId={match[1]} />;
        href = `/users/${match[1]}`;
      } else {
        item = "Users";
        href = "";
      }
      return [
        { item: "Users", href: "/users" },
        { item, href },
      ];
    },
    regex: /^\/projects\/[^\/]+\/users\/[^\/]+$/,
    type: 'hidden',
  },
  {
    name: (pathname: string) => {
      const match = pathname.match(/^\/projects\/[^\/]+\/teams\/([^\/]+)$/);
      let item;
      let href;
      if (match) {
        item = <TeamMemberBreadcrumbItem key='team-display-name' teamId={match[1]} />;
        href = `/teams/${match[1]}`;
      } else {
        item = "Members";
        href = "";
      }
      return [
        { item: "Teams", href: "/teams" },
        { item, href },
      ];
    },
    regex: /^\/projects\/[^\/]+\/teams\/[^\/]+$/,
    type: "hidden",
  },
  {
    name: (pathname: string) => {
      const match = pathname.match(/^\/projects\/[^\/]+\/email-drafts\/([^\/]+)$/);
      let item;
      let href;
      if (match) {
        item = <DraftBreadcrumbItem key='draft-display-name' draftId={match[1]} />;
        href = `/email-drafts/${match[1]}`;
      } else {
        item = "Draft";
        href = "";
      }
      return [
        { item: "Drafts", href: "/email-drafts" },
        { item, href },
      ];
    },
    regex: /^\/projects\/[^\/]+\/email-drafts\/[^\/]+$/,
    type: 'hidden',
  },
  {
    name: (pathname: string) => {
      const match = pathname.match(/^\/projects\/[^\/]+\/email-themes\/([^\/]+)$/);
      let item;
      let href;
      if (match) {
        item = <ThemeBreadcrumbItem key='theme-display-name' themeId={match[1]} />;
        href = `/email-themes/${match[1]}`;
      } else {
        item = "Theme";
        href = "";
      }
      return [
        { item: "Themes", href: "/email-themes" },
        { item, href },
      ];
    },
    regex: /^\/projects\/[^\/]+\/email-themes\/[^\/]+$/,
    type: 'hidden',
  },
  {
    name: (pathname: string) => {
      const match = pathname.match(/^\/projects\/[^\/]+\/email-templates\/([^\/]+)$/);
      let item;
      let href;
      if (match) {
        item = <TemplateBreadcrumbItem key='template-display-name' templateId={match[1]} />;
        href = `/email-templates/${match[1]}`;
      } else {
        item = "Templates";
        href = "";
      }
      return [
        { item: "Templates", href: "/email-templates" },
        { item, href },
      ];
    },
    regex: /^\/projects\/[^\/]+\/email-templates\/[^\/]+$/,
    type: 'hidden',
  },
  {
    name: (pathname: string) => {
      const match = pathname.match(/^\/projects\/[^\/]+\/webhooks\/([^\/]+)$/);
      let item;
      let href;
      if (match) {
        item = <WebhookBreadcrumbItem key='webhook-display-name' endpointId={match[1]} />;
        href = `/webhooks/${match[1]}`;
      } else {
        item = "Endpoint";
        href = "";
      }
      return [
        { item: "Webhooks", href: "/webhooks" },
        { item, href },
      ];
    },
    regex: /^\/projects\/[^\/]+\/webhooks\/[^\/]+$/,
    type: 'hidden',
  },
  {
    name: (pathname: string) => {
      const match = pathname.match(/^\/projects\/[^\/]+\/data-vault\/stores\/([^\/]+)$/);
      let item;
      let href;
      if (match) {
        item = <StoreBreadcrumbItem key='store-display-name' storeId={match[1]} />;
        href = `/data-vault/stores/${match[1]}`;
      } else {
        item = "Store";
        href = "";
      }
      return [
        { item: "Stores", href: "/data-vault/stores" },
        { item, href },
      ];
    },
    regex: /^\/projects\/[^\/]+\/data-vault\/stores\/[^\/]+$/,
    type: 'hidden',
  },
  {
    name: (pathname: string) => {
      const match = pathname.match(/^\/projects\/[^\/]+\/workflows\/([^\/]+)$/);
      let item;
      let href;
      if (match) {
        item = <WorkflowBreadcrumbItem key='workflow-display-name' workflowId={match[1]} />;
        href = `/workflows/${match[1]}`;
      } else {
        item = "Workflow";
        href = "";
      }
      return [
        { item: "Workflows", href: "/workflows" },
        { item, href },
      ];
    },
    regex: /^\/projects\/[^\/]+\/workflows\/[^\/]+$/,
    type: 'hidden',
  },
];

function TeamMemberBreadcrumbItem(props: { teamId: string }) {
  const stackAdminApp = useAdminApp();
  const team = stackAdminApp.useTeam(props.teamId);

  if (!team) {
    return null;
  } else {
    return team.displayName;
  }
}

function UserBreadcrumbItem(props: { userId: string }) {
  const stackAdminApp = useAdminApp();
  const user = stackAdminApp.useUser(props.userId);

  if (!user) {
    return null;
  } else {
    return user.displayName ?? user.primaryEmail ?? user.id;
  }
}

function ThemeBreadcrumbItem(props: { themeId: string }) {
  const stackAdminApp = useAdminApp();
  const theme = stackAdminApp.useEmailTheme(props.themeId);
  return theme.displayName;
}

function TemplateBreadcrumbItem(props: { templateId: string }) {
  const stackAdminApp = useAdminApp();
  const templates = stackAdminApp.useEmailTemplates();
  const template = templates.find((template) => template.id === props.templateId);
  if (!template) {
    return null;
  }
  return template.displayName;
}

function DraftBreadcrumbItem(props: { draftId: string }) {
  const stackAdminApp = useAdminApp();
  const drafts = stackAdminApp.useEmailDrafts();
  const draft = drafts.find((d) => d.id === props.draftId);
  if (!draft) {
    return null;
  }
  return draft.displayName;
}

function WebhookBreadcrumbItem(props: { endpointId: string }) {
  const stackAdminApp = useAdminApp();
  const config = stackAdminApp.useProject().useConfig();
  const webhook = config.webhooks.find((w: any) => w.id === props.endpointId);
  if (!webhook) {
    return null;
  }
  return webhook.displayName;
}

function StoreBreadcrumbItem(props: { storeId: string }) {
  const stackAdminApp = useAdminApp();
  const stores = stackAdminApp.useDataVaultStores();
  const store = stores.find((s) => s.id === props.storeId);
  if (!store) {
    return null;
  }
  return store.displayName;
}

function WorkflowBreadcrumbItem(props: { workflowId: string }) {
  const stackAdminApp = useAdminApp();
  const workflows = stackAdminApp.useWorkflows();
  const workflow = workflows.find((w) => w.id === props.workflowId);
  if (!workflow) {
    return null;
  }
  return workflow.displayName;
}

function NavItem({
  item,
  href,
  onClick,
  projectId,
  isExpanded,
  onToggle,
  onNavigate
}: {
  item: Item | AppSection,
  href?: string,
  onClick?: () => void,
  projectId?: string,
  isExpanded?: boolean,
  onToggle?: () => void,
  onNavigate?: () => void,
}) {
  const pathname = usePathname();
  const ref = useRef<any>(null);
  const isHovered = useHover(ref);

  const isSection = 'items' in item;

  const subItemsRef = useRef<any>(null);

  console.log("rerendering");

  // If this is a collapsible section
  const IconComponent = item.icon;
  const ButtonComponent: any = isSection ? "button" : Link;

  return (
    <div className={cn(
      "transition-[margin] duration-200",
      isExpanded && "my-1",
    )}>
      <ButtonComponent
        ref={ref}
        {...(isSection ? { onClick: onToggle } : { href })}
        className={cn(
          "flex items-center w-full py-1.5 px-4 text-left",
          isHovered && "bg-foreground/5",
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
          {item.items.map((item) => {
            return (
              <NavSubItem key={item.href} item={item} href={"/projects/" + projectId + item.href} onClick={onClick} />
            );
          })}
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
  item: { name: string, href: string, icon?: LucideIcon },
  href: string,
  onClick?: () => void,
}) {
  const ref = useRef<any>(null);
  const hover = useHover(ref);
  return (
    <Link
      ref={ref}
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center pl-10 pr-2 py-1 text-sm text-muted-foreground",
        hover && "bg-foreground/5 text-foreground"
      )}
    >
      <span>{item.name}</span>
    </Link>
  );
}

function SidebarContent({ projectId, onNavigate }: { projectId: string, onNavigate?: () => void }) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["authentication"]));

  const router = useRouter();

  // Get enabled apps with error handling and fallback
  const enabledApps = config.apps.installed;
  const enabledAppSections = appSections.filter((section) => getOrUndefined(enabledApps, section.appId)?.enabled);

  const toggleSection = (appId: string) => {
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
        {enabledAppSections.map((section) => (
          <NavItem
            key={section.appId}
            item={section}
            projectId={projectId}
            isExpanded={expandedSections.has(section.appId)}
            onToggle={() => toggleSection(section.appId)}
            onNavigate={onNavigate}
          />
        ))}

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
  // const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });
  // const projects = user.useOwnedProjects();
  const projects: any[] = [];

  const breadcrumbItems: BreadcrumbItem[] = useMemo(() => {
    try {
      // Check hidden breadcrumb items first
      const hiddenItem = hiddenBreadcrumbItems.find((item) => item.regex.test(pathname));
      if (hiddenItem) {
        const name = hiddenItem.name;
        let results: BreadcrumbItem[];
        if (typeof name === 'function') {
          results = name(pathname);
        } else {
          results = [];
        }
        return results.map((item) => ({
          item: item.item,
          href: `/projects/${projectId}${item.href}`,
        }));
      }

      // Check overview item
      if (overviewItem.regex.test(pathname)) {
        return [{
          item: overviewItem.name,
          href: `/projects/${projectId}${overviewItem.href}`,
        }];
      }

      // Check app sections
      for (const section of appSections) {
        for (const item of section.items) {
          if (item.regex.test(pathname)) {
            return [{
              item: item.name,
              href: `/projects/${projectId}${item.href}`,
            }];
          }
        }
      }

      // Check bottom items
      for (const item of bottomItems) {
        if (item.regex.test(pathname)) {
          return [{
            item: item.name,
            href: item.external ? item.href : `/projects/${projectId}${item.href}`,
          }];
        }
      }

      return [];
    } catch (error) {
      console.error('Breadcrumb error:', error);
      return [];
    }
  }, [pathname, projectId]);

  const selectedProject = projects.find((project) => project.id === projectId);

  if (mobile) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <Link href="/projects">Home</Link>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
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

export default function SidebarLayout(props: { projectId: string, children?: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [companionExpanded, setCompanionExpanded] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="w-full flex">
      {/* Left Sidebar */}
      <div className="flex-col border-r min-w-[240px] h-screen sticky top-0 hidden md:flex bg-slate-200/20 dark:bg-black/20 z-[10] relative">
        {/*
          If we put a backdrop blur on the sidebar div, it will create a new backdrop root,
          which would then make us unable to properly do a nested blur for the bottom elements
          of the sidebar. By putting the backdrop, and with it the backdrop root, in an element
          right behind all the contents, we get the same behavior but better.

          https://drafts.fxtf.org/filter-effects-2/#BackdropRoot
        */}
        <div className="absolute inset-0 backdrop-blur-md z-[-1]"></div>

        <SidebarContent projectId={props.projectId} />
      </div>

      {/* Main Content Area */}
      <div className="flex flex-col flex-grow w-0">
        {/* Header */}
        <div className="h-14 border-b flex items-center justify-between sticky top-0 backdrop-blur-md bg-slate-200/20 dark:bg-black/20 z-10 px-4 md:px-6">
          <div className="hidden md:flex">
            <HeaderBreadcrumb projectId={props.projectId} />
          </div>

          <div className="flex md:hidden items-center">
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
                <SidebarContent projectId={props.projectId} onNavigate={() => setSidebarOpen(false)} />
              </SheetContent>
            </Sheet>

            <div className="ml-4 flex md:hidden">
              <HeaderBreadcrumb projectId={props.projectId} mobile />
            </div>
          </div>

          <div className="flex gap-4 relative">
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
      <div className="h-screen sticky top-0 backdrop-blur-md bg-slate-200/20 dark:bg-black/20 z-[10]">
        <StackCompanion onExpandedChange={setCompanionExpanded} />
      </div>
    </div>
  );
}
