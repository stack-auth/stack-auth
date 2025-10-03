'use client';

import { Link } from "@/components/link";
import { Logo } from "@/components/logo";
import { ProjectSwitcher } from "@/components/project-switcher";
import { StackCompanion } from "@/components/stack-companion";
import ThemeToggle from "@/components/theme-toggle";
import { getPublicEnvVar } from '@/lib/env';
import { cn } from "@/lib/utils";
// import { UserButton, useUser } from "@stackframe/stack";
import { type AppId } from "@/lib/apps";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,

  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  buttonVariants
} from "@stackframe/stack-ui";
import {
  Book,
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
  Plus,
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
import { Fragment, useMemo, useState } from "react";
import { useAdminApp } from "./use-admin-app";

type BreadcrumbItem = { item: React.ReactNode, href: string }

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
  appId: AppId;
  name: string;
  icon: LucideIcon;
  items: {
    name: string;
    href: string;
    icon?: LucideIcon;
    regex: RegExp;
  }[];
};

type BottomItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  regex: RegExp;
  external?: boolean;
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
    href: '/apps/explore',
    icon: Plus,
    regex: /^\/projects\/[^\/]+\/apps\/explore$/,
  },
  {
    name: 'Project Settings',
    href: '/project-settings',
    icon: Settings,
    regex: /^\/projects\/[^\/]+\/project-settings$/,
  },
  {
    name: 'Documentation',
    href: 'https://docs.stack-auth.com/',
    icon: Book,
    regex: /^$/,
    external: true,
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
  const template = templates.find((template: any) => template.id === props.templateId);
  if (!template) {
    return null;
  }
  return template.displayName;
}

function DraftBreadcrumbItem(props: { draftId: string }) {
  const stackAdminApp = useAdminApp();
  const drafts = stackAdminApp.useEmailDrafts();
  const draft = drafts.find((d: any) => d.id === props.draftId);
  if (!draft) {
    return null;
  }
  return draft.displayName;
}

function WebhookBreadcrumbItem(props: { endpointId: string }) {
  const stackAdminApp = useAdminApp();
  const webhooks = stackAdminApp.useWebhooks();
  const webhook = webhooks.find((w: any) => w.id === props.endpointId);
  if (!webhook) {
    return null;
  }
  return webhook.displayName;
}

function StoreBreadcrumbItem(props: { storeId: string }) {
  const stackAdminApp = useAdminApp();
  const stores = stackAdminApp.useDataVaultStores();
  const store = stores.find((s: any) => s.id === props.storeId);
  if (!store) {
    return null;
  }
  return store.displayName;
}

function WorkflowBreadcrumbItem(props: { workflowId: string }) {
  const stackAdminApp = useAdminApp();
  const workflows = stackAdminApp.useWorkflows();
  const workflow = workflows.find((w: any) => w.id === props.workflowId);
  if (!workflow) {
    return null;
  }
  return workflow.displayName;
}

function NavItem({ item, href, onClick }: { item: Item, href: string, onClick?: () => void }) {
  const pathname = usePathname();
  const selected = useMemo(() => {
    let pathnameWithoutTrailingSlash = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    return item.regex.test(pathnameWithoutTrailingSlash);
  }, [item.regex, pathname]);

  return (
    <Link
      href={href}
      className={cn(
        buttonVariants({ variant: 'ghost', size: "sm" }),
        "flex-grow justify-start text-md text-zinc-800 dark:text-zinc-300 px-2",
        selected && "bg-muted",
      )}
      onClick={onClick}
      prefetch={true}
    >
      <item.icon className="mr-2 h-4 w-4" />
      {item.name}
    </Link>
  );
}

function SidebarContent({ projectId, onNavigate }: { projectId: string, onNavigate?: () => void }) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  
  // Get enabled apps with error handling and fallback
  const enabledApps = config?.apps?.installed || {};
  
  // Filter app sections to only show enabled apps
  // For now, show all sections until config is properly loaded
  const enabledAppSections = appSections;
  
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
      <div className="flex flex-grow flex-col gap-1 pt-2 overflow-y-auto">
        {/* Overview - always at top */}
        <div className="flex px-2">
          <NavItem item={overviewItem} onClick={onNavigate} href={`/projects/${projectId}${overviewItem.href}`} />
        </div>

        {/* App Sections */}
        {enabledAppSections.map((section) => {
          const isExpanded = expandedSections.has(section.appId);
          const IconComponent = section.icon;
          
          return (
            <div key={section.appId} className="px-2">
              <button
                onClick={() => toggleSection(section.appId)}
                className="flex items-center w-full py-2 px-2 text-left hover:bg-muted rounded-md transition-colors"
              >
                <IconComponent className="mr-2 h-4 w-4" />
                <span className="flex-1 font-medium">{section.name}</span>
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              
              {isExpanded && (
                <div className="ml-6 space-y-1">
                  {section.items.map((item) => {
                    const ItemIcon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={`/projects/${projectId}${item.href}`}
                        onClick={onNavigate}
                        className="flex items-center py-1 px-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                      >
                        {ItemIcon && <ItemIcon className="mr-2 h-3 w-3" />}
                        <span>{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <div className="flex-grow" />

        {/* Bottom Items */}
        <div className="py-2 space-y-1">
          {bottomItems.map((item) => (
            <div key={item.name} className="px-2">
              <NavItem
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
            </div>
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

  const selectedProject: any = useMemo(() => {
    return projects.find((project: any) => project.id === projectId);
  }, [projectId, projects]);

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
      <div className="flex-col border-r min-w-[240px] h-screen sticky top-0 hidden md:flex backdrop-blur-md bg-slate-200/20 dark:bg-black/20 z-[10]">
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
              <div>User Button Placeholder</div>
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
