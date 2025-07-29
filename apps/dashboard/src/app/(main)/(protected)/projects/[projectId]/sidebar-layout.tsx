'use client';

import { FeedbackDialog } from "@/components/feedback-dialog";
import { Link } from "@/components/link";
import { Logo } from "@/components/logo";
import { ProjectSwitcher } from "@/components/project-switcher";
import ThemeToggle from "@/components/theme-toggle";
import { getPublicEnvVar } from '@/lib/env';
import { cn } from "@/lib/utils";
import { AdminProject, UserButton, useUser } from "@stackframe/stack";
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
  buttonVariants
} from "@stackframe/stack-ui";
import {
  Book,
  Globe,
  KeyRound,
  Link as LinkIcon,
  LockKeyhole,
  LucideIcon,
  Mail,
  Menu,
  Palette,
  Settings,
  Settings2,
  ShieldEllipsis,
  SquarePen,
  User,
  Users,
  Webhook,
} from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { useAdminApp } from "./use-admin-app";

type BreadcrumbItem = { item: React.ReactNode, href: string }

type Label = {
  name: React.ReactNode,
  type: 'label',
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

const navigationItems: (Label | Item | Hidden)[] = [
  {
    name: "Overview",
    href: "/",
    regex: /^\/projects\/[^\/]+\/?$/,
    icon: Globe,
    type: 'item'
  },
  {
    name: "Users",
    type: 'label'
  },
  {
    name: "Users",
    href: "/users",
    regex: /^\/projects\/[^\/]+\/users$/,
    icon: User,
    type: 'item'
  },
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
    name: "Auth Methods",
    href: "/auth-methods",
    regex: /^\/projects\/[^\/]+\/auth-methods$/,
    icon: ShieldEllipsis,
    type: 'item'
  },
  {
    name: "Project Permissions",
    href: "/project-permissions",
    regex: /^\/projects\/[^\/]+\/project-permissions$/,
    icon: LockKeyhole,
    type: 'item'
  },
  {
    name: "Teams",
    type: 'label'
  },
  {
    name: "Teams",
    href: "/teams",
    regex: /^\/projects\/[^\/]+\/teams$/,
    icon: Users,
    type: 'item'
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
    name: "Team Permissions",
    href: "/team-permissions",
    regex: /^\/projects\/[^\/]+\/team-permissions$/,
    icon: LockKeyhole,
    type: 'item'
  },
  {
    name: "Team Settings",
    href: "/team-settings",
    regex: /^\/projects\/[^\/]+\/team-settings$/,
    icon: Settings2,
    type: 'item'
  },
  {
    name: "Emails",
    type: 'label'
  },
  {
    name: "Emails",
    href: "/emails",
    regex: /^\/projects\/[^\/]+\/emails$/,
    icon: Mail,
    type: 'item'
  },
  {
    name: "Templates",
    href: "/email-templates",
    regex: /^\/projects\/[^\/]+\/email-templates$/,
    icon: SquarePen,
    type: 'item'
  },
  {
    name: "Themes",
    href: "/email-themes",
    regex: /^\/projects\/[^\/]+\/email-themes$/,
    icon: Palette,
    type: 'item',
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
    name: "Configuration",
    type: 'label'
  },
  {
    name: "Domains",
    href: "/domains",
    regex: /^\/projects\/[^\/]+\/domains$/,
    icon: LinkIcon,
    type: 'item'
  },
  {
    name: "Webhooks",
    href: "/webhooks",
    regex: /^\/projects\/[^\/]+\/webhooks$/,
    icon: Webhook,
    type: 'item'
  },
  {
    name: (pathname: string) => {
      const match = pathname.match(/^\/projects\/[^\/]+\/webhooks\/([^\/]+)$/);
      let href;
      if (match) {
        href = `/teams/${match[1]}`;
      } else {
        href = "";
      }

      return [
        { item: "Webhooks", href: "/webhooks" },
        { item: "Endpoint", href },
      ];
    },
    regex: /^\/projects\/[^\/]+\/webhooks\/[^\/]+$/,
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
    name: "Stack Auth Keys",
    href: "/api-keys",
    regex: /^\/projects\/[^\/]+\/api-keys$/,
    icon: KeyRound,
    type: 'item'
  },
  {
    name: "Project Settings",
    href: "/project-settings",
    regex: /^\/projects\/[^\/]+\/project-settings$/,
    icon: Settings,
    type: 'item'
  }
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
        {navigationItems.map((item, index) => {
          if (item.type === 'label') {
            return <Typography key={index} className="pl-2 mt-3" type="label" variant="secondary">
              {item.name}
            </Typography>;
          } else if (item.type === 'item') {
            if (
              item.requiresDevFeatureFlag &&
              !JSON.parse(getPublicEnvVar("NEXT_PUBLIC_STACK_ENABLE_DEVELOPMENT_FEATURES_PROJECT_IDS") || "[]").includes(projectId)
            ) {
              return null;
            }
            return <div key={index} className="flex px-2">
              <NavItem item={item} onClick={onNavigate} href={`/projects/${projectId}${item.href}`} />
            </div>;
          }
        })}

        <div className="flex-grow" />

        <div className="py-2 px-2 flex">
          <NavItem
            onClick={onNavigate}
            item={{
              name: "Documentation",
              type: "item",
              href: "",
              icon: Book,
              regex: /^$/,
            }}
            href={"https://docs.stack-auth.com/"}
          />
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
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });
  const projects = user.useOwnedProjects();

  const breadcrumbItems: BreadcrumbItem[] = useMemo(() => {
    const item = navigationItems.find((item) => {
      if (item.type === 'label') {
        return false;
      } else {
        return item.regex.test(pathname);
      }
    });
    const name = item?.name;

    let results: BreadcrumbItem[];
    if (!name) {
      results = [];
    } else if (name instanceof Array) {
      results = name;
    } else if (typeof name === 'function') {
      results = name(pathname);
    } else {
      results = [{
        item: name,
        href: (item as any)?.href,
      }];
    }
    return results.map((item) => ({
      item: item.item,
      href: `/projects/${projectId}${item.href}`,
    }));
  }, [pathname, projectId]);

  const selectedProject: AdminProject | undefined = useMemo(() => {
    return projects.find((project) => project.id === projectId);
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
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="w-full flex">
      <div className="flex-col border-r min-w-[240px] h-screen sticky top-0 hidden md:flex backdrop-blur-md bg-white/20 dark:bg-black/20 z-[10]">
        <SidebarContent projectId={props.projectId} />
      </div>
      <div className="flex flex-col flex-grow w-0">
        <div className="h-14 border-b flex items-center justify-between sticky top-0 backdrop-blur-md bg-white/20 dark:bg-black/20 z-10 px-4 md:px-6">
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

          <div className="flex gap-4">
            <FeedbackDialog
              trigger={<Button variant="outline" size='sm'>Feedback</Button>}
            />
            {getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_ENABLED") === "true" ?
              <ThemeToggle /> :
              <UserButton colorModeToggle={() => setTheme(resolvedTheme === 'light' ? 'dark' : 'light')} />
            }
          </div>
        </div>
        <div className="flex-grow relative">
          {props.children}
        </div>
      </div>
    </div>
  );
}
