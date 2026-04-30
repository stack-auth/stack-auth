import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/projects/$projectId/dashboards")({
  component: DashboardsPage,
})

function DashboardsPage() {
  return (
    <div className="flex flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-[52px] w-full max-w-5xl items-center justify-between gap-3 px-6">
          <h1 className="font-heading text-base font-semibold tracking-tight">
            Dashboards
          </h1>
        </div>
      </header>
    </div>
  )
}
