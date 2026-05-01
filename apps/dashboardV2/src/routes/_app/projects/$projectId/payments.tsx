import { Link, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router"

import {
  ProjectPage,
  ProjectPageHeader,
} from "@/components/console/project-page"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/projects/$projectId/payments")({
  component: PaymentsLayout,
})

type SubNavTo =
  | "/projects/$projectId/payments"
  | "/projects/$projectId/payments/products"
  | "/projects/$projectId/payments/customers"
  | "/projects/$projectId/payments/transactions"
  | "/projects/$projectId/payments/settings"

type SubNavItem = {
  label: string,
  to: SubNavTo,
  exact?: boolean,
}

const SUB_NAV: ReadonlyArray<SubNavItem> = [
  { label: "Overview", to: "/projects/$projectId/payments", exact: true },
  { label: "Products", to: "/projects/$projectId/payments/products" },
  { label: "Customers", to: "/projects/$projectId/payments/customers" },
  { label: "Transactions", to: "/projects/$projectId/payments/transactions" },
  { label: "Settings", to: "/projects/$projectId/payments/settings" },
]

function PaymentsLayout() {
  const { projectId } = Route.useParams()
  const { location } = useRouterState()

  return (
    <ProjectPage>
      <ProjectPageHeader
        title="Payments"
        nav={(
          <nav className="-mb-px flex items-center gap-1">
            {SUB_NAV.map((item) => {
              const href = item.to.replace("$projectId", projectId)
              const active = item.exact
                ? location.pathname === href
                : location.pathname === href || location.pathname.startsWith(`${href}/`)
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

      <Outlet />
    </ProjectPage>
  )
}
