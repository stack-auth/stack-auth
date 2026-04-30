import { Link, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router"

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
    <div className="flex flex-col">
      <header className="border-b">
        <div className="mx-auto w-full max-w-6xl px-6 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
            <h1 className="font-heading text-base font-semibold tracking-tight">
              Emails
            </h1>
          </div>

          <nav className="mt-2 -mb-px flex items-center gap-1">
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
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
