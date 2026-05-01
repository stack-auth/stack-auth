import { Link } from "@tanstack/react-router"
import {
  ChartBarIcon,
  ChartLineIcon,
  CreditCardIcon,
  CubeIcon,
  EnvelopeIcon,
  FilmReelIcon,
  GaugeIcon,
  GearSixIcon,
  KeyIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  SignInIcon,
  UsersIcon,
  UsersThreeIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react"
import type { AppId } from "@stackframe/stack-shared/dist/apps/apps-config"

import type {
  ProjectSidebarNavGroup,
  ProjectSidebarNavTo,
} from "@/hooks/console/use-project-sidebar"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useProjectSidebar } from "@/hooks/console/use-project-sidebar"
import { ProjectSwitcher } from "@/components/console/project-switcher"

type NavTo = ProjectSidebarNavTo

type NavItem = {
  to: NavTo,
  label: string,
  Icon: typeof GaugeIcon,
  exact?: boolean,
  /** When set, the item only renders if the app is enabled in `config.apps.installed`. */
  appId?: AppId,
}

const NAV_GROUPS: ReadonlyArray<ProjectSidebarNavGroup<NavItem["Icon"]>> = [
  {
    label: "Project",
    items: [
      { to: "/projects/$projectId", label: "Overview", Icon: GaugeIcon, exact: true },
      { to: "/projects/$projectId/dashboards", label: "Dashboards", Icon: ChartBarIcon, appId: "analytics" },
    ],
  },
  {
    label: "Auth",
    items: [
      { to: "/projects/$projectId/users", label: "Users", Icon: UsersIcon, appId: "authentication" },
      { to: "/projects/$projectId/teams", label: "Teams", Icon: UsersThreeIcon, appId: "teams" },
      { to: "/projects/$projectId/auth-methods", label: "Auth methods", Icon: SignInIcon, appId: "authentication" },
      { to: "/projects/$projectId/onboarding", label: "Onboarding", Icon: RocketLaunchIcon, appId: "onboarding" },
      { to: "/projects/$projectId/permissions", label: "Permissions", Icon: ShieldCheckIcon, appId: "rbac" },
    ],
  },
  {
    label: "Messaging",
    items: [
      { to: "/projects/$projectId/emails", label: "Emails", Icon: EnvelopeIcon, appId: "emails" },
      { to: "/projects/$projectId/webhooks", label: "Webhooks", Icon: WebhooksLogoIcon, appId: "webhooks" },
    ],
  },
  {
    label: "Commerce",
    items: [
      { to: "/projects/$projectId/payments", label: "Payments", Icon: CreditCardIcon, appId: "payments" },
    ],
  },
  {
    label: "Analytics",
    items: [
      { to: "/projects/$projectId/events", label: "Events", Icon: ChartLineIcon, appId: "analytics" },
      { to: "/projects/$projectId/session-replays", label: "Session replay", Icon: FilmReelIcon, appId: "analytics" },
    ],
  },
  {
    label: "Configuration",
    items: [
      { to: "/projects/$projectId/apps", label: "Explore apps", Icon: CubeIcon },
      { to: "/projects/$projectId/api-keys", label: "API keys", Icon: KeyIcon, appId: "api-keys" },
      { to: "/projects/$projectId/settings", label: "Settings", Icon: GearSixIcon },
    ],
  },
]

function navItemDomId(to: NavTo) {
  return `project-sidebar-${to.replaceAll("/", "-").replaceAll("$", "")}`
}

export function ProjectSidebar() {
  const { project, projectId, isMac, visibleGroups, isActive } = useProjectSidebar(NAV_GROUPS)

  return (
    <Sidebar
      collapsible="icon"
      side="left"
      className="overflow-hidden rounded-e-lg border-e data-[side=left]:left-[var(--app-sidebar-width)]!"
    >
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1.5 py-1 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center">
          <div className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 font-heading text-xs font-semibold text-primary">
            {project.displayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="truncate font-heading text-sm font-medium leading-tight">
              {project.displayName}
            </p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {projectId}
            </p>
          </div>
          <ProjectSwitcher currentProjectId={projectId} />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(({ to, label, Icon, exact }) => {
                  const active = isActive(to, exact)
                  return (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton
                        id={navItemDomId(to)}
                        isActive={active}
                        tooltip={label}
                        render={
                          <Link to={to} params={{ projectId }} />
                        }
                      >
                        <Icon weight={active ? "fill" : "regular"} />
                        <span>{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center justify-between px-1.5 group-data-[collapsible=icon]:justify-center">
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase group-data-[collapsible=icon]:hidden">
            {isMac ? "Toggle ⌘B" : "Toggle Ctrl+B"}
          </span>
          <SidebarTrigger />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
