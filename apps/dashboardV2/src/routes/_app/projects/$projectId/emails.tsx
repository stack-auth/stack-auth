import { Link, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router"

import {
  ProjectPage,
  ProjectPageHeader,
  ProjectPageMain,
} from "@/components/console/project-page"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/projects/$projectId/emails")({
  component: EmailsLayout,
})

type SubNavTo =
  | "/projects/$projectId/emails/templates"
  | "/projects/$projectId/emails/themes"
  | "/projects/$projectId/emails/outbox"
  | "/projects/$projectId/emails/sent"
  | "/projects/$projectId/emails/drafts"
  | "/projects/$projectId/emails/domains"

type SubNavItem = {
  label: string,
  to: SubNavTo,
}

const SUB_NAV: ReadonlyArray<SubNavItem> = [
  { label: "Templates", to: "/projects/$projectId/emails/templates" },
  { label: "Themes", to: "/projects/$projectId/emails/themes" },
  { label: "Domains", to: "/projects/$projectId/emails/domains" },
  { label: "Outbox", to: "/projects/$projectId/emails/outbox" },
  { label: "Sent", to: "/projects/$projectId/emails/sent" },
  { label: "Drafts", to: "/projects/$projectId/emails/drafts" },
]

function EmailsLayout() {
  const { projectId } = Route.useParams()
  const { location } = useRouterState()

  return (
    <ProjectPage className="h-svh max-h-svh min-h-0 overflow-hidden">
      <ProjectPageHeader
        title="Emails"
        nav={(
          <nav className="-mb-px flex items-center gap-1">
            {SUB_NAV.map((item) => {
              const href = item.to.replace("$projectId", projectId)
              const active = location.pathname === href || location.pathname.startsWith(`${href}/`)
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  params={{ projectId }}
                  className={cn(
                    "relative inline-flex items-center rounded-t-md px-3 py-2 text-xs font-medium transition-colors hover:transition-none",
                    active
                      ? "text-foreground after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        )}
      />

      <ProjectPageMain className="h-[calc(100svh-88px)] min-h-0 flex-none overflow-hidden py-4">
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </ProjectPageMain>
    </ProjectPage>
  )
}
