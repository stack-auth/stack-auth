import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ShieldCheckIcon } from "@phosphor-icons/react"
import { toast } from "sonner"

import type { RestrictedReason } from "@stackframe/stack-shared/dist/schema-fields"

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
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  ProjectPage,
  ProjectPageHeader,
  ProjectPageMain,
} from "@/components/console/project-page"
import { useAdminApp } from "@/lib/stack/admin-app"
import {
  useAdminProject,
  useLoadedAdminProjectConfig,
  useStackAuthQueryInvalidation,
} from "@/lib/stack/react-query"

export const Route = createFileRoute("/_app/projects/$projectId/onboarding")({
  component: OnboardingPage,
})

type AffectedUser = {
  id: string,
  displayName: string | null,
  primaryEmail: string | null,
  restrictedReason: RestrictedReason,
}

type PendingEnable = {
  affectedUsers: Array<AffectedUser>,
  totalAffectedCount: number,
}

function OnboardingPage() {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const config = useLoadedAdminProjectConfig(project)
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()
  const isEnabled = config.onboarding.requireEmailVerification

  const [pending, setPending] = React.useState<boolean | null>(null)
  const [confirming, setConfirming] = React.useState<PendingEnable | null>(null)
  const display = pending ?? isEnabled

  const applyChange = async (next: boolean) => {
    setPending(next)
    try {
      await project.updateConfig({
        "onboarding.requireEmailVerification": next,
      })
      await invalidateProjectConfig(project.id)
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to update email verification requirement.",
      )
    } finally {
      setPending(null)
    }
  }

  const handleToggle = async (next: boolean) => {
    if (next && !isEnabled) {
      setPending(next)
      try {
        const preview = await adminApp.previewAffectedUsersByOnboardingChange(
          { requireEmailVerification: true },
          10,
        )
        if (preview.totalAffectedCount > 0) {
          setConfirming({
            affectedUsers: preview.affectedUsers,
            totalAffectedCount: preview.totalAffectedCount,
          })
          setPending(null)
          return
        }
      } catch (err) {
        setPending(null)
        toast.error(
          err instanceof Error
            ? err.message
            : "Failed to preview affected users.",
        )
        return
      }
      setPending(null)
    }
    await applyChange(next)
  }

  return (
    <ProjectPage>
      <ProjectPageHeader title="Onboarding" />

      <ProjectPageMain className="space-y-8">
        <section className="space-y-3">
          <h2 className="font-heading text-sm font-medium tracking-tight">
            Requirements
          </h2>
          <Card>
            <CardHeader>
              <CardTitle>Email verification</CardTitle>
              <CardDescription>
                Require users to verify their primary email address before they
                can continue using your application. Unverified users are
                filtered out by default when listing users and will be
                redirected to verify when using the SDK with redirect options.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <ShieldCheckIcon className="size-4 text-muted-foreground" />
                <Label htmlFor="require-email-verification" className="text-xs font-medium">
                  Require email verification
                </Label>
                <Badge variant={display ? "default" : "secondary"}>
                  {display ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <Switch
                id="require-email-verification"
                checked={display}
                disabled={pending != null}
                onCheckedChange={(next) => {
                  void handleToggle(next)
                }}
              />
            </CardContent>
          </Card>
        </section>
      </ProjectPageMain>

      <AlertDialog
        open={confirming != null}
        onOpenChange={(o) => {
          if (!o) setConfirming(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable email verification?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming
                ? `${confirming.totalAffectedCount} existing user${confirming.totalAffectedCount === 1 ? "" : "s"} will need to verify their email next time they visit your app.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {confirming && confirming.affectedUsers.length > 0 ? (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto">
              {confirming.affectedUsers.map((u) => (
                <li key={u.id} className="flex items-center gap-2 text-sm">
                  <span className="truncate text-foreground">
                    {u.displayName ?? u.primaryEmail ?? "Anonymous user"}
                  </span>
                  {u.displayName && u.primaryEmail ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {u.primaryEmail}
                    </span>
                  ) : null}
                  <Badge variant="secondary" className="ms-auto">
                    {u.restrictedReason.type === "email_not_verified"
                      ? "Unverified"
                      : "Anonymous"}
                  </Badge>
                </li>
              ))}
              {confirming.totalAffectedCount > confirming.affectedUsers.length ? (
                <li className="text-xs text-muted-foreground">
                  + {confirming.totalAffectedCount - confirming.affectedUsers.length} more
                </li>
              ) : null}
            </ul>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                setConfirming(null)
                await applyChange(true)
              }}
            >
              Enable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ProjectPage>
  )
}
