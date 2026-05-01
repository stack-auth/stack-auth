import { createFileRoute } from "@tanstack/react-router"
import {
  CubeIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react"
import type { VisibleAppId } from "@/hooks/projects/use-apps-page";

import type { AdminProject } from "@stackframe/tanstack-start"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { AppCard as AppCardChrome } from "@/components/console/app-card"
import {
  ProjectPage,
  ProjectPageHeader,
  ProjectPageMain,
} from "@/components/console/project-page"
import {
  ALL_APP_IDS,
  APP_CATEGORIES,
  isAppEnabled,
  useAppCard,
  useAppsPage,
} from "@/hooks/projects/use-apps-page"

export const Route = createFileRoute("/_app/projects/$projectId/apps")({
  component: AppsPage,
})

function AppsPage() {
  const {
    project,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    installedApps,
    enabledIds,
    filteredAppIds,
    categoryCount,
  } = useAppsPage()

  return (
    <ProjectPage>
      <ProjectPageHeader
        title="Apps"
        badge={(
          <Badge variant="secondary">
            {enabledIds.length} of {ALL_APP_IDS.length} enabled
          </Badge>
        )}
      />

      <ProjectPageMain className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <MagnifyingGlassIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search apps…"
              className="ps-9"
            />
          </div>

          <Tabs
            value={selectedCategory}
            onValueChange={(v) => setSelectedCategory(String(v))}
          >
            <TabsList>
              {APP_CATEGORIES.map((category) => (
                <TabsTrigger key={category.id} value={category.id}>
                  {category.label}
                  <span className="ms-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {categoryCount(category.id)}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {filteredAppIds.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia>
                <CubeIcon className="size-5" />
              </EmptyMedia>
              <EmptyTitle>No apps found</EmptyTitle>
              <EmptyDescription>
                {searchQuery.length > 0
                  ? `No apps match "${searchQuery}".`
                  : "No apps available in this category."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredAppIds.map((appId) => (
              <AppCard
                key={appId}
                appId={appId}
                enabled={isAppEnabled(installedApps, appId)}
                project={project}
              />
            ))}
          </div>
        )}
      </ProjectPageMain>
    </ProjectPage>
  )
}

function AppCard({
  appId,
  enabled,
  project,
}: {
  appId: VisibleAppId,
  enabled: boolean,
  project: AdminProject,
}) {
  const { app, confirmOpen, setConfirmOpen, pending, handleSwitch, enableConfirmed } =
    useAppCard({ appId, project })

  return (
    <>
      <AppCardChrome
        appId={appId}
        enabled={enabled}
        control={
          <Switch
            checked={enabled}
            onCheckedChange={handleSwitch}
            disabled={pending}
            aria-label={enabled ? `Disable ${app.displayName}` : `Enable ${app.displayName}`}
          />
        }
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Enable {app.displayName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {app.stage === "alpha"
                ? `${app.displayName} is in alpha. APIs and behavior may change without notice, and the feature may have bugs. Use at your own risk in production.`
                : `${app.displayName} is in beta. It is reasonably stable but APIs may still change before the stable release.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              render={
                <Button onClick={enableConfirmed} />
              }
            >
              Enable {app.stage}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
