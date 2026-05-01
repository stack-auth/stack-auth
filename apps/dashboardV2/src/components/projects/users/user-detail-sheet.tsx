import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises"
import {
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  CreditCardIcon,
  DotsThreeIcon,
  EnvelopeIcon,
  EnvelopeOpenIcon,
  KeyIcon,
  LockKeyIcon,
  PencilSimpleIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
  SignInIcon,
  TrashIcon,
  UserCircleIcon,
  UserIcon,
  UsersIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react"
import type {
  AdminEmailOutbox,
  ServerContactChannel,
  ServerOAuthProvider,
  ServerTeam,
  ServerUser,
  StackAdminApp,
} from "@stackframe/tanstack-start"
import type { Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions"
import type {UseInfiniteVirtualListResult} from "@/hooks/use-infinite-virtual-list";
import {
  
  useInfiniteVirtualList
} from "@/hooks/use-infinite-virtual-list"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ProjectDetailSheet } from "@/components/console/project-detail-sheet"
import { CodeEditor } from "@/components/projects/emails/code-editor"
import { formatRecentDashboardDate } from "@/lib/dates"
import { useAdminApp } from "@/lib/stack/admin-app"
import {
  stackAuthQueryKeys,
  useAdminProject,
  useLoadedAdminProjectConfig,
  useStripeAccountInfoQuery,
} from "@/lib/stack/react-query"
import { cn } from "@/lib/utils"

type AdminSessionReplay = Awaited<
  ReturnType<StackAdminApp<false>["listSessionReplays"]>
>["items"][number]

// ===================================================================
// Public exports
// ===================================================================

export function UserAvatar({
  user,
  size = "default",
}: {
  user: ServerUser
  size?: "default" | "sm" | "lg"
}) {
  const initial =
    user.displayName?.trim().charAt(0) ??
    user.primaryEmail?.trim().charAt(0) ??
    "?"
  return (
    <Avatar size={size}>
      {user.profileImageUrl == null ? null : (
        <AvatarImage
          src={user.profileImageUrl}
          alt={user.displayName ?? user.id}
        />
      )}
      <AvatarFallback>{initial.toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}

export function formatLongDate(date: Date | null): string {
  if (date == null) return "-"
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// ===================================================================
// Query helpers (kept inline; simple keys we own here)
// ===================================================================

function userContactChannelsKey(projectId: string, userId: string) {
  return ["user-contact-channels", projectId, userId] as const
}
function userOAuthProvidersKey(projectId: string, userId: string) {
  return ["user-oauth-providers", projectId, userId] as const
}
function userTeamsKey(projectId: string, userId: string) {
  return ["user-teams", projectId, userId] as const
}
function userOutboxEmailsKey(projectId: string, userId: string) {
  return ["user-outbox-emails", projectId, userId] as const
}
function userTransactionsKey(projectId: string, userId: string) {
  return ["user-transactions", projectId, userId] as const
}
function userSessionReplaysKey(projectId: string, userId: string) {
  return ["user-session-replays", projectId, userId] as const
}

function useUserContactChannelsQuery(
  adminApp: StackAdminApp<false>,
  user: ServerUser
) {
  return useQuery<Array<ServerContactChannel>>({
    queryKey: userContactChannelsKey(adminApp.projectId, user.id),
    queryFn: async () => await user.listContactChannels(),
  })
}
function useUserOAuthProvidersQuery(
  adminApp: StackAdminApp<false>,
  user: ServerUser
) {
  return useQuery<Array<ServerOAuthProvider>>({
    queryKey: userOAuthProvidersKey(adminApp.projectId, user.id),
    queryFn: async () => await user.listOAuthProviders(),
  })
}
function useUserTeamsQuery(adminApp: StackAdminApp<false>, user: ServerUser) {
  return useQuery<Array<ServerTeam>>({
    queryKey: userTeamsKey(adminApp.projectId, user.id),
    queryFn: async () => await user.listTeams(),
  })
}

function useUserOutboxEmailsInfinite(
  adminApp: StackAdminApp<false>,
  user: ServerUser,
  estimateSize: number
) {
  const primary = user.primaryEmail?.toLowerCase() ?? null
  return useInfiniteVirtualList<AdminEmailOutbox, string>({
    queryKey: userOutboxEmailsKey(adminApp.projectId, user.id),
    estimateSize,
    queryFn: async ({ pageParam }) => {
      const result = await adminApp.listOutboxEmails({
        limit: 100,
        ...(pageParam == null ? {} : { cursor: pageParam }),
      })
      const items = result.items.filter((item) => {
        const to = item.to
        if (to.type === "user-primary-email") return to.userId === user.id
        if (to.type === "user-custom-emails") return to.userId === user.id
        return (
          primary != null && to.emails.some((e) => e.toLowerCase() === primary)
        )
      })
      return { items, nextCursor: result.nextCursor ?? null }
    },
  })
}

function useUserTransactionsInfinite(
  adminApp: StackAdminApp<false>,
  user: ServerUser,
  estimateSize: number
) {
  return useInfiniteVirtualList<Transaction, string>({
    queryKey: userTransactionsKey(adminApp.projectId, user.id),
    estimateSize,
    queryFn: async ({ pageParam }) => {
      const result = await adminApp.listTransactions({
        limit: 100,
        customerType: "user",
        ...(pageParam == null ? {} : { cursor: pageParam }),
      })
      const items = result.transactions.filter((tx) =>
        tx.entries.some(
          (entry) =>
            "customer_id" in entry &&
            entry.customer_type === "user" &&
            entry.customer_id === user.id
        )
      )
      return { items, nextCursor: result.nextCursor ?? null }
    },
  })
}

function useUserSessionReplaysInfinite(
  adminApp: StackAdminApp<false>,
  user: ServerUser,
  estimateSize: number
) {
  return useInfiniteVirtualList<AdminSessionReplay, string>({
    queryKey: userSessionReplaysKey(adminApp.projectId, user.id),
    estimateSize,
    queryFn: async ({ pageParam }) => {
      const result = await adminApp.listSessionReplays({
        userIds: [user.id],
        limit: 50,
        ...(pageParam == null ? {} : { cursor: pageParam }),
      })
      return { items: result.items, nextCursor: result.nextCursor ?? null }
    },
  })
}

function useUserInvalidator(
  adminApp: StackAdminApp<false>,
  userId: string
) {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: stackAuthQueryKeys.projectUser(adminApp.projectId, userId),
      }),
      queryClient.invalidateQueries({
        queryKey: ["users-list", adminApp.projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: userContactChannelsKey(adminApp.projectId, userId),
      }),
      queryClient.invalidateQueries({
        queryKey: userOAuthProvidersKey(adminApp.projectId, userId),
      }),
      queryClient.invalidateQueries({
        queryKey: userTeamsKey(adminApp.projectId, userId),
      }),
    ])
  }
}

// ===================================================================
// UserDetailSheet
// ===================================================================

export function UserDetailSheet({
  user,
  open,
  onOpenChange,
  onViewTeam,
}: {
  user: ServerUser | null
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  onViewTeam: (teamId: string) => void
}) {
  return (
    <ProjectDetailSheet
      open={open}
      onOpenChange={onOpenChange}
      className="flex flex-col gap-0"
    >
      {user == null ? null : (
        <UserDetailContent
          key={user.id}
          user={user}
          onClose={() => onOpenChange(false)}
          onViewTeam={onViewTeam}
        />
      )}
    </ProjectDetailSheet>
  )
}

function UserDetailContent({
  user,
  onClose,
  onViewTeam,
}: {
  user: ServerUser
  onClose: () => void
  onViewTeam: (teamId: string) => void
}) {
  const adminApp = useAdminApp()
  const invalidate = useUserInvalidator(adminApp, user.id)

  // Reuses the same project-config query the sidebar already populated, so we
  // don't refetch app-installed flags here.
  const project = useAdminProject()
  const config = useLoadedAdminProjectConfig(project)
  const installedApps = config.apps.installed as Record<
    string,
    { enabled?: boolean } | undefined
  >
  const analyticsEnabled = installedApps.analytics?.enabled === true
  const paymentsAppEnabled = installedApps.payments?.enabled === true
  const stripeAccountQuery = useStripeAccountInfoQuery(adminApp)
  const paymentsEnabled =
    paymentsAppEnabled && stripeAccountQuery.data != null

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [impersonateSnippet, setImpersonateSnippet] = useState<string | null>(
    null
  )
  const [restrictionOpen, setRestrictionOpen] = useState(false)
  const [editingDisplayName, setEditingDisplayName] = useState(false)

  return (
    <>
      <SheetHeader className="sticky top-0 z-10 border-b bg-background pe-32">
        <div className="flex items-start gap-3">
          <UserAvatar user={user} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              {editingDisplayName ? (
                <DisplayNameEditor
                  user={user}
                  onDone={() => setEditingDisplayName(false)}
                  onSaved={invalidate}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingDisplayName(true)}
                  className="group/name flex min-w-0 items-center gap-1.5 text-left"
                >
                  <SheetTitle className="truncate text-base">
                    {user.displayName ?? user.primaryEmail ?? "Unnamed user"}
                  </SheetTitle>
                  <PencilSimpleIcon className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100" />
                </button>
              )}
              <UserKebabMenu
                user={user}
                onImpersonate={(snippet) => setImpersonateSnippet(snippet)}
                onDelete={() => setDeleteOpen(true)}
                onCheckout={() => setCheckoutOpen(true)}
                onRemove2fa={async () => {
                  await user.update({ totpMultiFactorSecret: null })
                  await invalidate()
                  toast.success("2FA removed.")
                }}
              />
            </div>
            <SheetDescription className="mt-1 flex items-center gap-2">
              <CopyableId value={user.id} />
              <span className="text-[11px] text-muted-foreground">
                Last active {formatRecentDashboardDate(user.lastActiveAt)}
              </span>
            </SheetDescription>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge
                variant={user.primaryEmailVerified ? "default" : "secondary"}
              >
                {user.primaryEmailVerified ? "Email verified" : "Email unverified"}
              </Badge>
              {user.isAnonymous ? (
                <Badge variant="secondary">Anonymous</Badge>
              ) : null}
              {user.isRestricted ? (
                <Badge variant="destructive">Restricted</Badge>
              ) : null}
              {user.isMultiFactorRequired ? (
                <Badge variant="default">2FA enabled</Badge>
              ) : null}
              {user.hasPassword ? (
                <Badge variant="secondary">Password</Badge>
              ) : null}
              {user.otpAuthEnabled ? (
                <Badge variant="secondary">OTP</Badge>
              ) : null}
              {user.passkeyAuthEnabled ? (
                <Badge variant="secondary">Passkey</Badge>
              ) : null}
            </div>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {user.isRestricted ? (
          <RestrictionBanner
            user={user}
            onManage={() => setRestrictionOpen(true)}
          />
        ) : null}

        <Tabs defaultValue="overview">
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="contact">Contact channels</TabsTrigger>
            <TabsTrigger value="oauth">OAuth</TabsTrigger>
            <TabsTrigger value="teams">Teams</TabsTrigger>
            <TabsTrigger value="emails">Emails</TabsTrigger>
            {paymentsEnabled ? (
              <TabsTrigger value="payments">Payments</TabsTrigger>
            ) : null}
            {analyticsEnabled ? (
              <TabsTrigger value="replays">Session replays</TabsTrigger>
            ) : null}
            <TabsTrigger value="metadata">Metadata</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="pt-4">
            <OverviewTab user={user} onChanged={invalidate} />
          </TabsContent>
          <TabsContent value="contact" className="pt-4">
            <ContactChannelsTab user={user} onChanged={invalidate} />
          </TabsContent>
          <TabsContent value="oauth" className="pt-4">
            <OAuthTab user={user} onChanged={invalidate} />
          </TabsContent>
          <TabsContent value="teams" className="pt-4">
            <TeamsTab user={user} onViewTeam={onViewTeam} />
          </TabsContent>
          <TabsContent value="emails" className="pt-4">
            <EmailsTab user={user} onClose={onClose} />
          </TabsContent>
          {paymentsEnabled ? (
            <TabsContent value="payments" className="pt-4">
              <PaymentsTab user={user} onClose={onClose} />
            </TabsContent>
          ) : null}
          {analyticsEnabled ? (
            <TabsContent value="replays" className="pt-4">
              <SessionReplaysTab user={user} onClose={onClose} />
            </TabsContent>
          ) : null}
          <TabsContent value="metadata" className="pt-4">
            <MetadataTab user={user} onChanged={invalidate} />
          </TabsContent>
        </Tabs>
      </div>

      <RestrictionDialog
        user={user}
        open={restrictionOpen}
        onOpenChange={setRestrictionOpen}
        onSaved={invalidate}
      />
      <ImpersonateUserDialog
        snippet={impersonateSnippet}
        onClose={() => setImpersonateSnippet(null)}
      />
      <CreateCheckoutDialog
        user={user}
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
      />
      <DeleteUserDialog
        user={user}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => {
          setDeleteOpen(false)
          runAsynchronouslyWithAlert(invalidate())
          onClose()
        }}
      />
    </>
  )
}

function DisplayNameEditor({
  user,
  onDone,
  onSaved,
}: {
  user: ServerUser
  onDone: () => void
  onSaved: () => Promise<void>
}) {
  const [value, setValue] = useState(user.displayName ?? "")
  const [submitting, setSubmitting] = useState(false)

  const handleSave = async () => {
    setSubmitting(true)
    try {
      const next = value.trim()
      await user.setDisplayName(next === "" ? null : next)
      await onSaved()
      toast.success("Display name updated.")
      onDone()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update display name."
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Input
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            void handleSave()
          } else if (e.key === "Escape") {
            onDone()
          }
        }}
        className="h-7 max-w-xs"
        disabled={submitting}
      />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Save"
        disabled={submitting}
        onClick={() => void handleSave()}
      >
        <CheckIcon />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Cancel"
        disabled={submitting}
        onClick={onDone}
      >
        <XIcon />
      </Button>
    </div>
  )
}

function UserKebabMenu({
  user,
  onImpersonate,
  onDelete,
  onCheckout,
  onRemove2fa,
}: {
  user: ServerUser
  onImpersonate: (snippet: string) => void
  onDelete: () => void
  onCheckout: () => void
  onRemove2fa: () => Promise<void>
}) {
  const adminApp = useAdminApp()

  const handleImpersonate = async () => {
    const expiresInMillis = 1000 * 60 * 60 * 2
    const expiresAtDate = new Date(Date.now() + expiresInMillis)
    const session = await user.createSession({
      expiresInMillis,
      isImpersonation: true,
    })
    const tokens = await session.getTokens()
    if (tokens.refreshToken == null) {
      throw new Error("Impersonation session did not return a refresh token.")
    }
    onImpersonate(
      [
        `document.cookie = 'stack-refresh-${adminApp.projectId}=${tokens.refreshToken}; expires=${expiresAtDate.toUTCString()}; path=/';`,
        "window.location.reload();",
      ].join("\n")
    )
  }

  const handleSendReset = async () => {
    const email = user.primaryEmail
    if (email == null) {
      toast.error("This user has no primary email.")
      return
    }
    const result = await adminApp.sendForgotPasswordEmail(email)
    if (result.status === "ok") {
      toast.success(`Password reset email sent to ${email}.`)
    } else {
      toast.error(`Failed to send: ${result.error.message}`)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="User actions"
            className="ms-auto"
          />
        }
      >
        <DotsThreeIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {user.primaryEmail != null ? (
          <DropdownMenuItem
            onClick={() => runAsynchronouslyWithAlert(handleSendReset)}
          >
            <EnvelopeIcon />
            Send password reset
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={() => runAsynchronouslyWithAlert(handleImpersonate)}
        >
          <UsersIcon />
          Impersonate
        </DropdownMenuItem>
        {user.isMultiFactorRequired ? (
          <DropdownMenuItem
            onClick={() => runAsynchronouslyWithAlert(onRemove2fa)}
          >
            <ShieldWarningIcon />
            Remove 2FA
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={onCheckout}>
          <CreditCardIcon />
          Create checkout
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <TrashIcon />
          Delete user
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ===================================================================
// Restriction banner
// ===================================================================

function RestrictionBanner({
  user,
  onManage,
}: {
  user: ServerUser
  onManage: () => void
}) {
  const reasonType = user.restrictedReason?.type ?? null
  const heading =
    reasonType === "anonymous"
      ? "Anonymous user"
      : reasonType === "email_not_verified"
        ? "Email not verified"
        : reasonType === "restricted_by_administrator"
          ? "Restricted by administrator"
          : "Restricted"

  const isAdminRestricted = reasonType === "restricted_by_administrator"

  return (
    <Alert variant="destructive">
      <ShieldWarningIcon />
      <AlertTitle>{heading}</AlertTitle>
      <AlertDescription className="space-y-2">
        {isAdminRestricted ? (
          <>
            <p>
              This user has been restricted by an administrator. They cannot
              sign in until the restriction is lifted.
            </p>
            {user.restrictedByAdminReason ? (
              <div className="rounded-md bg-destructive/10 p-2 text-xs">
                <p className="font-mono text-[10px] tracking-wider uppercase opacity-70">
                  Public reason
                </p>
                <p className="mt-1">{user.restrictedByAdminReason}</p>
              </div>
            ) : null}
            {user.restrictedByAdminPrivateDetails ? (
              <div className="rounded-md bg-destructive/10 p-2 text-xs">
                <p className="font-mono text-[10px] tracking-wider uppercase opacity-70">
                  Private notes
                </p>
                <p className="mt-1 whitespace-pre-wrap">
                  {user.restrictedByAdminPrivateDetails}
                </p>
              </div>
            ) : null}
          </>
        ) : reasonType === "anonymous" ? (
          <p>This user signed in anonymously and has limited access.</p>
        ) : reasonType === "email_not_verified" ? (
          <p>This user must verify their email before signing in.</p>
        ) : (
          <p>This user is currently restricted.</p>
        )}
        <div className="pt-1">
          <Button size="sm" variant="outline" onClick={onManage}>
            Manage restriction
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}

function RestrictionDialog({
  user,
  open,
  onOpenChange,
  onSaved,
}: {
  user: ServerUser
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  onSaved: () => Promise<void>
}) {
  const [publicReason, setPublicReason] = useState(
    user.restrictedByAdminReason ?? ""
  )
  const [privateDetails, setPrivateDetails] = useState(
    user.restrictedByAdminPrivateDetails ?? ""
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPublicReason(user.restrictedByAdminReason ?? "")
      setPrivateDetails(user.restrictedByAdminPrivateDetails ?? "")
      setError(null)
    }
  }, [open, user])

  const handleSave = async () => {
    if (privateDetails.trim() === "") {
      setError("Private details are required when restricting a user.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await user.update({
        restrictedByAdmin: true,
        restrictedByAdminReason: publicReason.trim() || null,
        restrictedByAdminPrivateDetails: privateDetails.trim(),
      })
      await onSaved()
      toast.success("Restriction saved.")
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save restriction."
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemove = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await user.update({
        restrictedByAdmin: false,
        restrictedByAdminReason: null,
        restrictedByAdminPrivateDetails: null,
      })
      await onSaved()
      toast.success("Manual restriction removed.")
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to remove restriction."
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage restriction</DialogTitle>
          <DialogDescription>
            Restrict this user from signing in. The public reason may be shown
            to them; private notes are admin-only.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="restrict-public-reason">
              Public reason{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="restrict-public-reason"
              value={publicReason}
              onChange={(e) => setPublicReason(e.target.value)}
              placeholder="Account suspended"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="restrict-private-details">
              Private notes (admin-only)
            </Label>
            <Textarea
              id="restrict-private-details"
              value={privateDetails}
              onChange={(e) => setPrivateDetails(e.target.value)}
              placeholder="Why was this user restricted?"
              rows={4}
            />
          </div>
          {error == null ? null : (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <div>
            {user.restrictedByAdmin ? (
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => runAsynchronouslyWithAlert(handleRemove)}
              >
                Remove manual restriction
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={submitting}
              onClick={() => runAsynchronouslyWithAlert(handleSave)}
            >
              {submitting ? "Saving…" : "Save & restrict"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===================================================================
// Overview tab
// ===================================================================

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-foreground">
      {children}
    </h3>
  )
}

function SectionGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-foreground/10 overflow-hidden rounded-md ring-1 ring-foreground/10">
      {children}
    </div>
  )
}

function OverviewTab({
  user,
  onChanged,
}: {
  user: ServerUser
  onChanged: () => Promise<void>
}) {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <SectionHeading>Identity</SectionHeading>
        <SectionGroup>
          <ReadOnlyRow icon={<UserIcon />} label="User ID">
            <CopyableId value={user.id} />
          </ReadOnlyRow>
          <ReadOnlyRow icon={<EnvelopeIcon />} label="Primary email">
            {user.primaryEmail ? (
              <span className="truncate">{user.primaryEmail}</span>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </ReadOnlyRow>
          <InlineEditableField
            icon={<UserCircleIcon />}
            label="Display name"
            value={user.displayName ?? ""}
            placeholder="No name"
            onSave={async (next) => {
              await user.setDisplayName(next === "" ? null : next)
              await onChanged()
            }}
          />
          <PasswordEditableField user={user} onSaved={onChanged} />
        </SectionGroup>
      </section>

      <section className="space-y-2">
        <SectionHeading>Auth</SectionHeading>
        <SectionGroup>
          <ReadOnlyRow icon={<ShieldCheckIcon />} label="2-Factor Auth">
            <Badge
              variant={user.isMultiFactorRequired ? "default" : "secondary"}
            >
              {user.isMultiFactorRequired ? "Enabled" : "Disabled"}
            </Badge>
          </ReadOnlyRow>
          <ReadOnlyRow icon={<LockKeyIcon />} label="Has password">
            <Badge variant={user.hasPassword ? "default" : "secondary"}>
              {user.hasPassword ? "Yes" : "No"}
            </Badge>
          </ReadOnlyRow>
          <ReadOnlyRow icon={<KeyIcon />} label="OTP enabled">
            <Badge variant={user.otpAuthEnabled ? "default" : "secondary"}>
              {user.otpAuthEnabled ? "Yes" : "No"}
            </Badge>
          </ReadOnlyRow>
          <ReadOnlyRow icon={<UserIcon />} label="Anonymous">
            <Badge variant={user.isAnonymous ? "default" : "secondary"}>
              {user.isAnonymous ? "Yes" : "No"}
            </Badge>
          </ReadOnlyRow>
        </SectionGroup>
      </section>

      <section className="space-y-2">
        <SectionHeading>Activity</SectionHeading>
        <SectionGroup>
          <ReadOnlyRow icon={<CheckCircleIcon />} label="Signed up at">
            <span>{formatLongDate(user.signedUpAt)}</span>
          </ReadOnlyRow>
          <ReadOnlyRow icon={<CheckCircleIcon />} label="Last active at">
            <span>{formatLongDate(user.lastActiveAt)}</span>
          </ReadOnlyRow>
        </SectionGroup>
      </section>

      <section className="space-y-2">
        <SectionHeading>Risk & geo</SectionHeading>
        <SectionGroup>
          <InlineEditableField
            icon={<UserIcon />}
            label="Country code"
            value={user.countryCode ?? ""}
            placeholder="Not set"
            normalize={(v) => v.toUpperCase().slice(0, 2)}
            onSave={async (next) => {
              await user.update({ countryCode: next === "" ? null : next })
              await onChanged()
            }}
          />
          <InlineEditableField
            icon={<WarningIcon />}
            label="Risk: bot"
            value={String(user.riskScores.signUp.bot)}
            inputType="number"
            placeholder="0"
            onSave={async (next) => {
              const parsed = clampScore(next)
              await user.update({
                riskScores: {
                  signUp: {
                    bot: parsed,
                    freeTrialAbuse: user.riskScores.signUp.freeTrialAbuse,
                  },
                },
              })
              await onChanged()
            }}
          />
          <InlineEditableField
            icon={<WarningIcon />}
            label="Risk: free-trial abuse"
            value={String(user.riskScores.signUp.freeTrialAbuse)}
            inputType="number"
            placeholder="0"
            onSave={async (next) => {
              const parsed = clampScore(next)
              await user.update({
                riskScores: {
                  signUp: {
                    bot: user.riskScores.signUp.bot,
                    freeTrialAbuse: parsed,
                  },
                },
              })
              await onChanged()
            }}
          />
        </SectionGroup>
      </section>
    </div>
  )
}

function clampScore(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, Math.round(n)))
}

function ReadOnlyRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-10 items-center gap-3 bg-card px-3 py-2">
      <div className="flex w-40 shrink-0 items-center gap-2 text-sm text-muted-foreground">
        <span className="[&_svg]:size-3.5">{icon}</span>
        {label}
      </div>
      <div className="flex min-w-0 flex-1 items-center text-sm">
        {children}
      </div>
    </div>
  )
}

function InlineEditableField({
  icon,
  label,
  value,
  placeholder,
  inputType = "text",
  normalize,
  onSave,
}: {
  icon: React.ReactNode
  label: string
  value: string
  placeholder?: string
  inputType?: "text" | "number"
  normalize?: (raw: string) => string
  onSave: (next: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const handleSave = async () => {
    setSubmitting(true)
    try {
      const next = normalize ? normalize(draft.trim()) : draft.trim()
      await onSave(next)
      toast.success(`${label} updated.`)
      setEditing(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to update ${label}.`
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-10 items-center gap-3 bg-card px-3 py-2">
      <div className="flex w-40 shrink-0 items-center gap-2 text-sm text-muted-foreground">
        <span className="[&_svg]:size-3.5">{icon}</span>
        {label}
      </div>
      <div className="flex min-w-0 flex-1 items-center">
        {editing ? (
          <div className="flex w-full items-center gap-1.5">
            <Input
              type={inputType}
              value={draft}
              autoFocus
              disabled={submitting}
              onChange={(e) => {
                const raw = e.target.value
                setDraft(normalize ? normalize(raw) : raw)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave()
                else if (e.key === "Escape") setEditing(false)
              }}
              className="h-7"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={submitting}
              aria-label="Save"
              onClick={() => void handleSave()}
            >
              <CheckIcon />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={submitting}
              aria-label="Cancel"
              onClick={() => setEditing(false)}
            >
              <XIcon />
            </Button>
          </div>
        ) : (
          <div className="group/edit flex w-full min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                value === "" ? "text-muted-foreground" : ""
              )}
            >
              {value === "" ? (placeholder ?? "Not set") : value}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Edit ${label}`}
              className="opacity-0 transition-opacity group-hover/edit:opacity-100"
              onClick={() => setEditing(true)}
            >
              <PencilSimpleIcon />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function PasswordEditableField({
  user,
  onSaved,
}: {
  user: ServerUser
  onSaved: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const handleSave = async () => {
    if (draft.length === 0) return
    setSubmitting(true)
    try {
      const result = await user.setPassword({ password: draft })
      // setPassword returns Result-shape if requirements not met
      if (
        result != null &&
        typeof result === "object" &&
        "name" in result &&
        result.name === "PasswordRequirementsNotMet"
      ) {
        toast.error("Password does not meet requirements.")
        return
      }
      await onSaved()
      toast.success("Password updated.")
      setDraft("")
      setEditing(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update password."
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-10 items-center gap-3 bg-card px-3 py-2">
      <div className="flex w-40 shrink-0 items-center gap-2 text-sm text-muted-foreground">
        <span className="[&_svg]:size-3.5">
          <LockKeyIcon />
        </span>
        Password
      </div>
      <div className="flex min-w-0 flex-1 items-center">
        {editing ? (
          <div className="flex w-full items-center gap-1.5">
            <Input
              type="password"
              value={draft}
              autoFocus
              disabled={submitting}
              placeholder="New password"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave()
                else if (e.key === "Escape") setEditing(false)
              }}
              className="h-7"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={submitting || draft.length === 0}
              aria-label="Save"
              onClick={() => void handleSave()}
            >
              <CheckIcon />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={submitting}
              aria-label="Cancel"
              onClick={() => {
                setDraft("")
                setEditing(false)
              }}
            >
              <XIcon />
            </Button>
          </div>
        ) : (
          <div className="group/edit flex w-full min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                !user.hasPassword ? "text-muted-foreground" : "font-mono"
              )}
            >
              {user.hasPassword ? "••••••••" : "Not set"}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Edit password"
              className="opacity-0 transition-opacity group-hover/edit:opacity-100"
              onClick={() => setEditing(true)}
            >
              <PencilSimpleIcon />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ===================================================================
// Contact channels tab
// ===================================================================

function ContactChannelsTab({
  user,
  onChanged,
}: {
  user: ServerUser
  onChanged: () => Promise<void>
}) {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const config = useLoadedAdminProjectConfig(project)
  const channelsQuery = useUserContactChannelsQuery(adminApp, user)
  const channels = channelsQuery.data
  const [addOpen, setAddOpen] = useState(false)
  const [sendDialog, setSendDialog] = useState<{
    channel: ServerContactChannel
    kind: "verification" | "reset" | "signin"
  } | null>(null)

  const credentialEnabled = config.auth.password.allowSignIn

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionHeading>Email channels</SectionHeading>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <PlusIcon /> Add email
        </Button>
      </div>

      {channels == null ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : channels.length === 0 ? (
        <p className="rounded-md bg-card p-6 text-center text-xs text-muted-foreground ring-1 ring-foreground/10">
          No contact channels.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md ring-1 ring-foreground/10">
          <div className="grid grid-cols-[minmax(0,2fr)_5rem_5rem_5rem_3rem] items-center gap-2 border-b bg-muted/40 px-3 py-2 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            <span>Email</span>
            <span>Primary</span>
            <span>Verified</span>
            <span>Sign-in</span>
            <span />
          </div>
          <ul className="divide-y divide-border">
            {channels.map((c) => (
              <ContactChannelRow
                key={c.id}
                channel={c}
                user={user}
                credentialEnabled={credentialEnabled}
                onChanged={onChanged}
                onSend={(kind) => setSendDialog({ channel: c, kind })}
              />
            ))}
          </ul>
        </div>
      )}

      <AddContactChannelDialog
        user={user}
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={onChanged}
      />

      {sendDialog == null ? null : (
        <SendEmailDialog
          channel={sendDialog.channel}
          kind={sendDialog.kind}
          onClose={() => setSendDialog(null)}
        />
      )}
    </div>
  )
}

function ContactChannelRow({
  channel,
  user,
  credentialEnabled,
  onChanged,
  onSend,
}: {
  channel: ServerContactChannel
  user: ServerUser
  credentialEnabled: boolean
  onChanged: () => Promise<void>
  onSend: (kind: "verification" | "reset" | "signin") => void
}) {
  const handleToggleVerified = async () => {
    await channel.update({ isVerified: !channel.isVerified })
    await onChanged()
    toast.success(channel.isVerified ? "Marked unverified." : "Marked verified.")
  }
  const handleSetPrimary = async () => {
    await channel.update({ isPrimary: true })
    await onChanged()
    toast.success("Set as primary.")
  }
  const handleToggleSignIn = async () => {
    await channel.update({ usedForAuth: !channel.usedForAuth })
    await onChanged()
    toast.success(
      channel.usedForAuth ? "Removed from sign-in." : "Enabled for sign-in."
    )
  }
  const handleDelete = async () => {
    await channel.delete()
    await onChanged()
    toast.success("Email removed.")
  }

  // Suppress unused-warning for user (kept for parity with row needs)
  void user

  return (
    <li className="grid grid-cols-[minmax(0,2fr)_5rem_5rem_5rem_3rem] items-center gap-2 px-3 py-2.5">
      <span className="min-w-0 truncate text-xs">{channel.value}</span>
      <span>
        {channel.isPrimary ? (
          <CheckIcon className="size-3.5 text-foreground" />
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </span>
      <span>
        {channel.isVerified ? (
          <CheckIcon className="size-3.5 text-foreground" />
        ) : (
          <WarningIcon className="size-3.5 text-muted-foreground" />
        )}
      </span>
      <span>
        {channel.usedForAuth ? (
          <CheckIcon className="size-3.5 text-foreground" />
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Channel actions"
            />
          }
        >
          <DotsThreeIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => onSend("signin")}>
            <SignInIcon /> Send sign-in invitation
          </DropdownMenuItem>
          {!channel.isVerified ? (
            <DropdownMenuItem onClick={() => onSend("verification")}>
              <EnvelopeOpenIcon /> Send verification email
            </DropdownMenuItem>
          ) : null}
          {credentialEnabled ? (
            <DropdownMenuItem onClick={() => onSend("reset")}>
              <KeyIcon /> Send password reset
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => runAsynchronouslyWithAlert(handleToggleVerified)}
          >
            <ShieldCheckIcon />
            {channel.isVerified ? "Mark unverified" : "Mark verified"}
          </DropdownMenuItem>
          {!channel.isPrimary ? (
            <DropdownMenuItem
              onClick={() => runAsynchronouslyWithAlert(handleSetPrimary)}
            >
              <CheckCircleIcon />
              Set as primary
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={() => runAsynchronouslyWithAlert(handleToggleSignIn)}
          >
            <SignInIcon />
            {channel.usedForAuth
              ? "Disable for sign-in"
              : "Enable for sign-in"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => runAsynchronouslyWithAlert(handleDelete)}
          >
            <TrashIcon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function AddContactChannelDialog({
  user,
  open,
  onOpenChange,
  onCreated,
}: {
  user: ServerUser
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  onCreated: () => Promise<void>
}) {
  const [value, setValue] = useState("")
  const [isVerified, setIsVerified] = useState(false)
  const [isPrimary, setIsPrimary] = useState(false)
  const [usedForAuth, setUsedForAuth] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setValue("")
    setIsVerified(false)
    setIsPrimary(false)
    setUsedForAuth(true)
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) {
      setError("Email is required.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await user.createContactChannel({
        type: "email",
        value: value.trim(),
        isVerified,
        isPrimary,
        usedForAuth,
      })
      await onCreated()
      toast.success("Email added.")
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add email.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            void handleSubmit(e)
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Add email</DialogTitle>
            <DialogDescription>
              Add a new email contact channel to this user.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cc-email">Email</Label>
              <Input
                id="cc-email"
                type="email"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="user@example.com"
                autoFocus
                required
              />
            </div>
            <SwitchRow
              id="cc-verified"
              label="Set as verified"
              checked={isVerified}
              onCheckedChange={setIsVerified}
            />
            <SwitchRow
              id="cc-primary"
              label="Set as primary"
              checked={isPrimary}
              onCheckedChange={setIsPrimary}
            />
            <SwitchRow
              id="cc-auth"
              label="Used for sign-in"
              checked={usedForAuth}
              onCheckedChange={setUsedForAuth}
            />
            {error == null ? null : (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding…" : "Add email"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SwitchRow({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between rounded-md bg-card px-3 py-2 ring-1 ring-foreground/10">
      <Label htmlFor={id} className="cursor-pointer text-xs">
        {label}
      </Label>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

function SendEmailDialog({
  channel,
  kind,
  onClose,
}: {
  channel: ServerContactChannel
  kind: "verification" | "reset" | "signin"
  onClose: () => void
}) {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const config = useLoadedAdminProjectConfig(project)
  const trustedDomains = Object.values(config.domains.trustedDomains).map(
    (d) => ({
      baseUrl: d.baseUrl,
      handlerPath: d.handlerPath,
    })
  )
  const allowLocalhost = config.domains.allowLocalhost === true
  const initialDomain =
    trustedDomains[0]?.baseUrl ?? (allowLocalhost ? "" : "")
  const initialHandler = trustedDomains[0]?.handlerPath ?? "/handler"

  const [useLocalhost, setUseLocalhost] = useState(
    trustedDomains.length === 0 && allowLocalhost
  )
  const [domain, setDomain] = useState(initialDomain)
  const [port, setPort] = useState("3000")
  const [handlerPath, setHandlerPath] = useState(initialHandler)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)

  const title =
    kind === "verification"
      ? "Send verification email"
      : kind === "reset"
        ? "Send password reset"
        : "Send sign-in invitation"

  const endpoint =
    kind === "verification"
      ? "email-verification"
      : kind === "reset"
        ? "password-reset"
        : "sign-in"

  const buildCallbackUrl = () => {
    const baseUrl = useLocalhost
      ? `http://localhost:${port.trim() || "3000"}`
      : domain.trim()
    if (!baseUrl) {
      throw new Error("Pick a domain or enable localhost.")
    }
    const trimmedHandler = handlerPath.trim() || "/handler"
    return `${baseUrl.replace(/\/+$/, "")}${trimmedHandler}/${endpoint}`
  }

  const handleSend = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const callbackUrl = buildCallbackUrl()
      if (kind === "verification") {
        await channel.sendVerificationEmail({ callbackUrl })
        toast.success(`Verification email sent to ${channel.value}.`)
      } else if (kind === "reset") {
        const result = await adminApp.sendForgotPasswordEmail(channel.value, {
          callbackUrl,
        })
        if (result.status === "ok") {
          toast.success(`Reset email sent to ${channel.value}.`)
        } else {
          throw new Error(result.error.message)
        }
      } else {
        await adminApp.sendSignInInvitationEmail(channel.value, callbackUrl)
        toast.success(`Sign-in invitation sent to ${channel.value}.`)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send email.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Pick the domain to use as the callback. The email will redirect the
            recipient to{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              {handlerPath}/{endpoint}
            </code>{" "}
            on that domain.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {trustedDomains.length === 0 && !allowLocalhost ? (
            <Alert variant="destructive">
              <AlertDescription>
                No trusted domains configured. Add one in Settings.
              </AlertDescription>
            </Alert>
          ) : null}

          {trustedDomains.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="send-domain">Domain</Label>
              <Select
                items={[
                  ...trustedDomains.map((d) => ({
                    value: d.baseUrl,
                    label: d.baseUrl,
                  })),
                  ...(allowLocalhost
                    ? [{ value: "__localhost__", label: "localhost" }]
                    : []),
                ]}
                value={useLocalhost ? "__localhost__" : domain}
                onValueChange={(v: string | null) => {
                  if (v === "__localhost__") {
                    setUseLocalhost(true)
                  } else if (v != null) {
                    setUseLocalhost(false)
                    setDomain(v)
                    const matching = trustedDomains.find((d) => d.baseUrl === v)
                    if (matching) setHandlerPath(matching.handlerPath)
                  }
                }}
              >
                <SelectTrigger id="send-domain" className="w-full">
                  <SelectValue placeholder="Select a domain" />
                </SelectTrigger>
                <SelectContent>
                  {trustedDomains.map((d) => (
                    <SelectItem key={d.baseUrl} value={d.baseUrl}>
                      {d.baseUrl}
                    </SelectItem>
                  ))}
                  {allowLocalhost ? (
                    <SelectItem value="__localhost__">localhost</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {useLocalhost ? (
            <div className="space-y-1.5">
              <Label htmlFor="send-port">Localhost port</Label>
              <Input
                id="send-port"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="3000"
              />
            </div>
          ) : null}

          <div>
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setAdvanced((a) => !a)}
            >
              {advanced ? "Hide advanced" : "Advanced"}
            </button>
          </div>

          {advanced ? (
            <div className="space-y-1.5">
              <Label htmlFor="send-handler">Handler path</Label>
              <Input
                id="send-handler"
                value={handlerPath}
                onChange={(e) => setHandlerPath(e.target.value)}
                placeholder="/handler"
              />
            </div>
          ) : null}

          {error == null ? null : (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={() => runAsynchronouslyWithAlert(handleSend)}
          >
            {submitting ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===================================================================
// OAuth tab
// ===================================================================

type OAuthProviderConfig = {
  id: string
  type: string
  allowSignIn?: boolean
}

function getConfigOAuthProviders(
  config: ReturnType<typeof useLoadedAdminProjectConfig>
): Array<OAuthProviderConfig> {
  const providers = config.auth.oauth.providers as
    | Record<string, { type?: string, allowSignIn?: boolean } | undefined>
    | undefined
  if (providers == null) return []
  return Object.entries(providers)
    .filter(([, entry]) => entry != null)
    .map(([id, entry]) => ({
      id,
      type: entry?.type ?? id,
      allowSignIn: entry?.allowSignIn,
    }))
}

function OAuthTab({
  user,
  onChanged,
}: {
  user: ServerUser
  onChanged: () => Promise<void>
}) {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const config = useLoadedAdminProjectConfig(project)
  const providersQuery = useUserOAuthProvidersQuery(adminApp, user)
  const providers = providersQuery.data
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<ServerOAuthProvider | null>(null)

  const providerConfigs = useMemo(
    () => getConfigOAuthProviders(config),
    [config]
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionHeading>OAuth providers</SectionHeading>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <PlusIcon /> Add provider
        </Button>
      </div>

      {providers == null ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : providers.length === 0 ? (
        <p className="rounded-md bg-card p-6 text-center text-xs text-muted-foreground ring-1 ring-foreground/10">
          No OAuth providers linked.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md ring-1 ring-foreground/10">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_5rem_6rem_3rem] items-center gap-2 border-b bg-muted/40 px-3 py-2 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            <span>Provider</span>
            <span>Email</span>
            <span>Account ID</span>
            <span>Sign-in</span>
            <span>Connected</span>
            <span />
          </div>
          <ul className="divide-y divide-border">
            {providers.map((p) => (
              <OAuthProviderRow
                key={p.id}
                provider={p}
                onEdit={() => setEditing(p)}
                onChanged={onChanged}
              />
            ))}
          </ul>
        </div>
      )}

      <OAuthProviderDialog
        mode={editing ? "edit" : "create"}
        open={addOpen || editing != null}
        provider={editing}
        user={user}
        providerConfigs={providerConfigs}
        onOpenChange={(o) => {
          if (!o) {
            setAddOpen(false)
            setEditing(null)
          }
        }}
        onSaved={onChanged}
      />
    </div>
  )
}

function OAuthProviderRow({
  provider,
  onEdit,
  onChanged,
}: {
  provider: ServerOAuthProvider
  onEdit: () => void
  onChanged: () => Promise<void>
}) {
  const handleToggle = async (
    field: "allowSignIn" | "allowConnectedAccounts"
  ) => {
    const next =
      field === "allowSignIn"
        ? !provider.allowSignIn
        : !provider.allowConnectedAccounts
    const result = await provider.update({ [field]: next })
    if (result.status === "error") {
      toast.error(result.error.message)
      return
    }
    await onChanged()
    toast.success("Provider updated.")
  }
  const handleDelete = async () => {
    await provider.delete()
    await onChanged()
    toast.success("Provider removed.")
  }

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_5rem_6rem_3rem] items-center gap-2 px-3 py-2.5">
      <span className="truncate text-xs font-medium capitalize">
        {provider.type}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {provider.email ?? "-"}
      </span>
      <code className="truncate font-mono text-[11px] text-muted-foreground">
        {provider.accountId}
      </code>
      <Switch
        checked={provider.allowSignIn}
        onCheckedChange={() =>
          runAsynchronouslyWithAlert(handleToggle("allowSignIn"))
        }
        size="sm"
      />
      <Switch
        checked={provider.allowConnectedAccounts}
        onCheckedChange={() =>
          runAsynchronouslyWithAlert(handleToggle("allowConnectedAccounts"))
        }
        size="sm"
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Provider actions"
            />
          }
        >
          <DotsThreeIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={onEdit}>
            <PencilSimpleIcon /> Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => runAsynchronouslyWithAlert(handleDelete)}
          >
            <TrashIcon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function OAuthProviderDialog({
  mode,
  open,
  provider,
  user,
  providerConfigs,
  onOpenChange,
  onSaved,
}: {
  mode: "create" | "edit"
  open: boolean
  provider: ServerOAuthProvider | null
  user: ServerUser
  providerConfigs: Array<OAuthProviderConfig>
  onOpenChange: (nextOpen: boolean) => void
  onSaved: () => Promise<void>
}) {
  const adminApp = useAdminApp()
  const [providerId, setProviderId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState("")
  const [email, setEmail] = useState("")
  const [allowSignIn, setAllowSignIn] = useState(true)
  const [allowConnected, setAllowConnected] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && provider != null) {
      setProviderId(provider.type)
      setAccountId(provider.accountId)
      setEmail(provider.email ?? "")
      setAllowSignIn(provider.allowSignIn)
      setAllowConnected(provider.allowConnectedAccounts)
    } else {
      setProviderId(providerConfigs[0]?.id ?? null)
      setAccountId("")
      setEmail("")
      setAllowSignIn(true)
      setAllowConnected(true)
    }
    setError(null)
  }, [open, mode, provider, providerConfigs])

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      if (mode === "edit" && provider != null) {
        const result = await provider.update({
          email: email.trim() || undefined,
          allowSignIn,
          allowConnectedAccounts: allowConnected,
        })
        if (result.status === "error") {
          throw new Error(result.error.message)
        }
        toast.success("Provider updated.")
      } else {
        if (providerId == null) {
          throw new Error("Pick a provider.")
        }
        if (!accountId.trim()) {
          throw new Error("Account ID is required.")
        }
        const result = await adminApp.createOAuthProvider({
          userId: user.id,
          providerConfigId: providerId,
          accountId: accountId.trim(),
          email: email.trim(),
          allowSignIn,
          allowConnectedAccounts: allowConnected,
        })
        if (result.status === "error") {
          throw new Error(result.error.message)
        }
        toast.success("Provider linked.")
      }
      await onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Edit OAuth provider" : "Link OAuth provider"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update sign-in and connected-account permissions."
              : "Link an external OAuth provider account to this user."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="oauth-provider">Provider</Label>
            {mode === "edit" ? (
              <Input
                id="oauth-provider"
                value={providerId ?? ""}
                disabled
                className="capitalize"
              />
            ) : providerConfigs.length === 0 ? (
              <Alert>
                <AlertDescription>
                  No OAuth providers configured for this project.
                </AlertDescription>
              </Alert>
            ) : (
              <Select
                items={providerConfigs.map((p) => ({
                  value: p.id,
                  label: p.id,
                }))}
                value={providerId}
                onValueChange={(v: string | null) => setProviderId(v)}
              >
                <SelectTrigger id="oauth-provider" className="w-full">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {providerConfigs.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="capitalize">{p.id}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oauth-account-id">Account ID</Label>
            <Input
              id="oauth-account-id"
              value={accountId}
              disabled={mode === "edit"}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="The provider's user id"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oauth-email">
              Email{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="oauth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <SwitchRow
            id="oauth-signin"
            label="Used for sign-in"
            checked={allowSignIn}
            onCheckedChange={setAllowSignIn}
          />
          <SwitchRow
            id="oauth-connected"
            label="Used for connected accounts"
            checked={allowConnected}
            onCheckedChange={setAllowConnected}
          />
          {error == null ? null : (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={() => runAsynchronouslyWithAlert(handleSubmit)}
          >
            {submitting ? "Saving…" : mode === "edit" ? "Save" : "Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===================================================================
// Teams tab
// ===================================================================

function TeamsTab({
  user,
  onViewTeam,
}: {
  user: ServerUser
  onViewTeam: (teamId: string) => void
}) {
  const adminApp = useAdminApp()
  const queryClient = useQueryClient()
  const teamsQuery = useUserTeamsQuery(adminApp, user)
  const teams = teamsQuery.data

  const [removeTarget, setRemoveTarget] = useState<ServerTeam | null>(null)
  const [removing, setRemoving] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const invalidateUserTeams = async () => {
    await queryClient.invalidateQueries({
      queryKey: userTeamsKey(adminApp.projectId, user.id),
    })
  }

  const handleRemove = async (team: ServerTeam) => {
    setRemoving(true)
    try {
      await team.removeUser(user.id)
      toast.success(`Removed from ${team.displayName}`)
      await invalidateUserTeams()
      setRemoveTarget(null)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove from team."
      )
    } finally {
      setRemoving(false)
    }
  }

  if (teams == null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {teams.length === 0
            ? "Not a member of any teams."
            : `Member of ${teams.length} team${teams.length === 1 ? "" : "s"}.`}
        </p>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <PlusIcon className="size-4" />
          Add to team
        </Button>
      </div>

      {teams.length === 0 ? (
        <p className="rounded-md bg-card p-6 text-center text-xs text-muted-foreground ring-1 ring-foreground/10">
          Not a member of any teams.
        </p>
      ) : (
        <ul className="space-y-2">
          {teams.map((team) => (
            <li
              key={team.id}
              className="flex items-center gap-3 rounded-md bg-card p-3 ring-1 ring-foreground/10"
            >
              <Avatar size="default">
                {team.profileImageUrl ? (
                  <AvatarImage
                    src={team.profileImageUrl}
                    alt={team.displayName}
                  />
                ) : null}
                <AvatarFallback>
                  {team.displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {team.displayName}
                </p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {team.id}
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {new Date(team.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onViewTeam(team.id)}
              >
                View team
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRemoveTarget(team)}
                aria-label={`Remove from ${team.displayName}`}
              >
                <TrashIcon className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AddUserToTeamDialog
        user={user}
        open={addOpen}
        onOpenChange={setAddOpen}
        memberTeamIds={new Set(teams.map((t) => t.id))}
        onAdded={invalidateUserTeams}
      />

      <AlertDialog
        open={removeTarget != null}
        onOpenChange={(o) => {
          if (!o && !removing) setRemoveTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from team</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget == null
                ? null
                : `This removes ${user.displayName ?? user.primaryEmail ?? "the user"} from ${removeTarget.displayName}. They will lose access to anything scoped to this team.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removing}
              onClick={() => {
                if (removeTarget != null) {
                  void handleRemove(removeTarget)
                }
              }}
            >
              {removing ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function AddUserToTeamDialog({
  user,
  open,
  onOpenChange,
  memberTeamIds,
  onAdded,
}: {
  user: ServerUser
  open: boolean
  onOpenChange: (next: boolean) => void
  memberTeamIds: Set<string>
  onAdded: () => Promise<void>
}) {
  const adminApp = useAdminApp()
  const allTeamsQuery = useQuery<Array<ServerTeam>>({
    queryKey: ["admin-all-teams", adminApp.projectId],
    queryFn: async () => await adminApp.listTeams(),
    enabled: open,
  })
  const [search, setSearch] = useState("")
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSearch("")
      setSubmittingId(null)
    }
  }, [open])

  const available = useMemo(() => {
    const teams = allTeamsQuery.data ?? []
    const q = search.trim().toLowerCase()
    return teams
      .filter((t) => !memberTeamIds.has(t.id))
      .filter((t) => {
        if (q.length === 0) return true
        return (
          t.displayName.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q)
        )
      })
  }, [allTeamsQuery.data, memberTeamIds, search])

  const handleAdd = async (team: ServerTeam) => {
    setSubmittingId(team.id)
    try {
      await team.addUser(user.id)
      toast.success(`Added to ${team.displayName}`)
      await onAdded()
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add to team."
      )
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to team</DialogTitle>
          <DialogDescription>
            Pick a team to add this user to. Only teams the user is not already
            in are shown.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Search teams…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />

        <div className="max-h-72 overflow-y-auto rounded-md ring-1 ring-foreground/10">
          {allTeamsQuery.isLoading ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : available.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              {(allTeamsQuery.data ?? []).length === 0
                ? "No teams in this project."
                : search.trim().length > 0
                  ? "No matching teams."
                  : "User is already in every team."}
            </p>
          ) : (
            <ul className="divide-y divide-foreground/10">
              {available.map((team) => (
                <li
                  key={team.id}
                  className="flex items-center gap-3 p-2"
                >
                  <Avatar size="default">
                    {team.profileImageUrl ? (
                      <AvatarImage
                        src={team.profileImageUrl}
                        alt={team.displayName}
                      />
                    ) : null}
                    <AvatarFallback>
                      {team.displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {team.displayName}
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {team.id}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={submittingId != null}
                    onClick={() => {
                      void handleAdd(team)
                    }}
                  >
                    {submittingId === team.id ? "Adding…" : "Add"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submittingId != null}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===================================================================
// Metadata tab
// ===================================================================

function MetadataTab({
  user,
  onChanged,
}: {
  user: ServerUser
  onChanged: () => Promise<void>
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <MetadataEditor
        title="Client metadata"
        hint="Visible to all clients (signed-in or not)."
        initial={user.clientMetadata}
        onSave={async (parsed) => {
          await user.setClientMetadata(parsed)
          await onChanged()
        }}
      />
      <MetadataEditor
        title="Client read-only"
        hint="Visible to clients but only writable from server."
        initial={user.clientReadOnlyMetadata}
        onSave={async (parsed) => {
          await user.setClientReadOnlyMetadata(parsed)
          await onChanged()
        }}
      />
      <MetadataEditor
        title="Server metadata"
        hint="Server-only. Never exposed to clients."
        initial={user.serverMetadata}
        onSave={async (parsed) => {
          await user.setServerMetadata(parsed)
          await onChanged()
        }}
      />
    </div>
  )
}

function MetadataEditor({
  title,
  hint,
  initial,
  onSave,
}: {
  title: string
  hint: string
  initial: unknown
  onSave: (parsed: unknown) => Promise<void>
}) {
  const initialJson = useMemo(
    () => JSON.stringify(initial ?? null, null, 2),
    [initial]
  )
  const [value, setValue] = useState(initialJson)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setValue(initialJson)
  }, [initialJson])

  const dirty = value !== initialJson
  const parseError = useMemo(() => {
    try {
      JSON.parse(value)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid JSON"
    }
  }, [value])

  const handleSave = async () => {
    if (parseError != null) return
    setSubmitting(true)
    try {
      const parsed = JSON.parse(value) as unknown
      await onSave(parsed)
      toast.success(`${title} saved.`)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to save ${title}.`
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-md bg-card p-3 ring-1 ring-foreground/10">
      <div className="mb-1 flex items-center justify-between">
        <SectionHeading>{title}</SectionHeading>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">{hint}</p>
      <CodeEditor
        ariaLabel={`${title} JSON editor`}
        value={value}
        onChange={setValue}
        className="h-[260px]"
      />
      {parseError == null ? null : (
        <p className="mt-2 text-[11px] text-destructive">{parseError}</p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!dirty || submitting}
          onClick={() => setValue(initialJson)}
        >
          Revert
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!dirty || parseError != null || submitting}
          onClick={() => runAsynchronouslyWithAlert(handleSave)}
        >
          {submitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}

// ===================================================================
// Shared dialogs (re-exports of moved-out users.tsx pieces)
// ===================================================================

export function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  onCreated: () => Promise<void>
}) {
  const adminApp = useAdminApp()
  const [primaryEmail, setPrimaryEmail] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setPrimaryEmail("")
    setDisplayName("")
    setPassword("")
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!primaryEmail.trim()) {
      setError("Primary email is required.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await adminApp.createUser({
        primaryEmail: primaryEmail.trim(),
        displayName: displayName.trim() === "" ? undefined : displayName.trim(),
        password: password === "" ? undefined : password,
        primaryEmailAuthEnabled: password === "" ? undefined : true,
      })
      await onCreated()
      toast.success("User created")
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            void handleSubmit(e)
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>
              Create a user manually. They will be able to sign in with this
              email and password.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="user-email">Primary email</Label>
              <Input
                id="user-email"
                type="email"
                value={primaryEmail}
                onChange={(e) => setPrimaryEmail(e.target.value)}
                placeholder="user@example.com"
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-name">
                Display name{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="user-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-password">
                Password{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="user-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank to disable password auth"
              />
            </div>
            {error == null ? null : (
              <Alert variant="destructive">
                <AlertTitle>Could not create user</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ImpersonateUserDialog({
  snippet,
  onClose,
}: {
  snippet: string | null
  onClose: () => void
}) {
  return (
    <Dialog
      open={snippet != null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Impersonate user</DialogTitle>
          <DialogDescription>
            Open your app, paste this snippet into the browser console, then
            reload.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="impersonate-snippet">Console snippet</Label>
          <div className="flex items-start gap-2">
            <textarea
              id="impersonate-snippet"
              value={snippet ?? ""}
              readOnly
              className="min-h-24 flex-1 resize-none rounded-md border bg-muted px-3 py-2 font-mono text-xs outline-none"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy impersonation snippet"
              onClick={async () => {
                if (snippet == null) return
                await navigator.clipboard.writeText(snippet)
                toast.success("Snippet copied")
              }}
            >
              <CopyIcon />
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CreateCheckoutDialog({
  user,
  open,
  onOpenChange,
}: {
  user: ServerUser
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
}) {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const config = useLoadedAdminProjectConfig(project)
  const products = useMemo(() => {
    return Object.entries(config.payments.products)
      .filter(([, product]) => product.customerType === "user")
      .map(([id, product]) => ({
        id,
        label: product.displayName,
      }))
  }, [config.payments.products])
  const [productId, setProductId] = useState<string | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setProductId(null)
    setCheckoutUrl(null)
    setError(null)
  }

  const handleCreate = async () => {
    if (productId == null) {
      setError("Choose a product before creating a checkout URL.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const url = await user.createCheckoutUrl({ productId })
      setCheckoutUrl(url)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create checkout URL."
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset()
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create checkout</DialogTitle>
          <DialogDescription>
            Generate a temporary checkout URL for this user.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {products.length === 0 ? (
            <Alert>
              <AlertTitle>No user products</AlertTitle>
              <AlertDescription>
                Add a user product before creating a checkout URL.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="checkout-product">Product</Label>
              <Select
                items={products.map((product) => ({
                  value: product.id,
                  label: product.label,
                }))}
                value={productId}
                onValueChange={(value: string | null) => setProductId(value)}
              >
                <SelectTrigger id="checkout-product" className="w-full">
                  <SelectValue placeholder="Select a product" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {checkoutUrl == null ? null : (
            <div className="space-y-1.5">
              <Label htmlFor="checkout-url">Checkout URL</Label>
              <div className="flex items-center gap-2">
                <Input id="checkout-url" value={checkoutUrl} readOnly />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy checkout URL"
                  onClick={async () => {
                    await navigator.clipboard.writeText(checkoutUrl)
                    toast.success("Checkout URL copied")
                  }}
                >
                  <CopyIcon />
                </Button>
              </div>
            </div>
          )}

          {error == null ? null : (
            <Alert variant="destructive">
              <AlertTitle>Checkout failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={() => {
              runAsynchronouslyWithAlert(handleCreate)
            }}
            disabled={submitting || products.length === 0}
          >
            {submitting ? "Creating…" : "Create URL"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteUserDialog({
  user,
  open,
  onOpenChange,
  onDeleted,
}: {
  user: ServerUser
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  onDeleted: () => void
}) {
  const [confirmText, setConfirmText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmTarget = user.primaryEmail ?? user.id
  const canDelete = confirmText === confirmTarget

  const handleDelete = async () => {
    if (!canDelete) return
    setSubmitting(true)
    setError(null)
    try {
      await user.delete()
      toast.success("User deleted")
      setConfirmText("")
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setConfirmText("")
          setError(null)
        }
        onOpenChange(o)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete user</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the user, their sessions, and all
            associated data. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor="confirm-delete">
            Type{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              {confirmTarget}
            </code>{" "}
            to confirm.
          </Label>
          <Input
            id="confirm-delete"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
          />
          {error == null ? null : (
            <Alert variant="destructive">
              <AlertTitle>Delete failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!canDelete || submitting}
            onClick={() => {
              void handleDelete()
            }}
          >
            {submitting ? "Deleting…" : "Delete user"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ===================================================================
// CopyableId helper
// ===================================================================

export function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "Copied" : "Copy"}
        onClick={() => {
          void onCopy()
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </span>
  )
}

// ===================================================================
// Emails / Payments / Session replays tabs
// ===================================================================

const ROW_HEIGHT = 64
const PANEL_HEIGHT = 420

function VirtualizedListPanel<TItem>({
  list,
  getItemKey,
  renderRow,
  emptyMessage,
  errorPrefix,
}: {
  list: UseInfiniteVirtualListResult<TItem>
  getItemKey: (item: TItem) => string
  renderRow: (item: TItem, index: number) => React.ReactNode
  emptyMessage: string
  errorPrefix: string
}) {
  const {
    parentRef,
    virtualizer,
    items,
    isLoading,
    isError,
    error,
    hasNextPage,
    isFetchingNextPage,
  } = list

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  if (isError) {
    return (
      <p className="rounded-md bg-card p-6 text-center text-xs text-destructive ring-1 ring-destructive/30">
        {errorPrefix}:{" "}
        {error instanceof Error ? error.message : "unknown error"}
      </p>
    )
  }

  if (items.length === 0 && !hasNextPage) {
    return (
      <p className="rounded-md bg-card p-6 text-center text-xs text-muted-foreground ring-1 ring-foreground/10">
        {emptyMessage}
      </p>
    )
  }

  const totalSize = virtualizer.getTotalSize()
  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div
      ref={parentRef}
      className="overflow-y-auto rounded-md ring-1 ring-foreground/10"
      style={{ height: PANEL_HEIGHT }}
    >
      <div
        className="relative w-full"
        style={{ height: `${totalSize}px` }}
      >
        {virtualItems.map((virtualRow) => {
          const isLoader = virtualRow.index >= items.length
          const item = isLoader ? null : items[virtualRow.index]
          return (
            <div
              key={
                isLoader
                  ? `__loader_${virtualRow.index}`
                  : getItemKey(item as TItem)
              }
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {isLoader ? (
                <div
                  className="flex items-center justify-center text-xs text-muted-foreground"
                  style={{ height: ROW_HEIGHT }}
                >
                  {isFetchingNextPage || hasNextPage ? "Loading more…" : null}
                </div>
              ) : (
                <div style={{ height: ROW_HEIGHT }}>
                  {renderRow(item as TItem, virtualRow.index)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EmailsTab({
  user,
  onClose,
}: {
  user: ServerUser
  onClose: () => void
}) {
  const adminApp = useAdminApp()
  const navigate = useNavigate()
  const list = useUserOutboxEmailsInfinite(adminApp, user, ROW_HEIGHT)

  return (
    <VirtualizedListPanel
      list={list}
      getItemKey={(email) => email.id}
      emptyMessage="No emails sent to this user yet."
      errorPrefix="Failed to load emails"
      renderRow={(email) => (
        <button
          type="button"
          onClick={() => {
            onClose()
            void navigate({
              to: "/projects/$projectId/emails/outbox",
              params: { projectId: adminApp.projectId },
            })
          }}
          className="flex h-full w-full items-start gap-3 border-b bg-card px-3 py-2 text-left transition-colors hover:bg-muted/50 hover:transition-none"
        >
          <EnvelopeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {"subject" in email && email.subject
                ? email.subject
                : "(no subject)"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {emailRecipientLabel(email, user)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={emailStatusVariant(email.simpleStatus)}>
              {email.status}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {formatRecentDashboardDate(email.createdAt)}
            </span>
          </div>
        </button>
      )}
    />
  )
}

function emailRecipientLabel(email: AdminEmailOutbox, user: ServerUser): string {
  const to = email.to
  if (to.type === "user-primary-email") {
    return user.primaryEmail ?? "Primary email"
  }
  if (to.type === "user-custom-emails") {
    return to.emails.join(", ")
  }
  return to.emails.join(", ")
}

function emailStatusVariant(
  status: AdminEmailOutbox["simpleStatus"]
): "default" | "secondary" | "destructive" {
  if (status === "ok") return "default"
  if (status === "error") return "destructive"
  return "secondary"
}

function PaymentsTab({
  user,
  onClose,
}: {
  user: ServerUser
  onClose: () => void
}) {
  const adminApp = useAdminApp()
  const navigate = useNavigate()
  const list = useUserTransactionsInfinite(adminApp, user, ROW_HEIGHT)

  return (
    <VirtualizedListPanel
      list={list}
      getItemKey={(tx) => tx.id}
      emptyMessage="No transactions for this user yet."
      errorPrefix="Failed to load transactions"
      renderRow={(tx) => {
        const userEntries = tx.entries.filter(
          (entry) =>
            "customer_id" in entry &&
            entry.customer_type === "user" &&
            entry.customer_id === user.id
        )
        return (
          <button
            type="button"
            onClick={() => {
              onClose()
              void navigate({
                to: "/projects/$projectId/payments/transactions",
                params: { projectId: adminApp.projectId },
              })
            }}
            className="flex h-full w-full items-start gap-3 border-b bg-card px-3 py-2 text-left transition-colors hover:bg-muted/50 hover:transition-none"
          >
            <CreditCardIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {tx.type ?? "transaction"}
                {tx.test_mode ? (
                  <span className="ms-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    test
                  </span>
                ) : null}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {transactionEntriesSummary(userEntries)}
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {formatRecentDashboardDate(new Date(tx.created_at_millis))}
            </span>
          </button>
        )
      }}
    />
  )
}

function transactionEntriesSummary(
  entries: Array<Transaction["entries"][number]>
): string {
  if (entries.length === 0) return "—"
  return entries
    .map((entry) => {
      if (entry.type === "money_transfer") {
        const usd = entry.charged_amount.USD
        const amount = usd != null ? `$${usd}` : Object.entries(entry.charged_amount).map(([cur, amt]) => `${amt} ${cur}`).join(", ")
        return `Charged ${amount}`
      }
      if (entry.type === "item_quantity_change") {
        const sign = entry.quantity >= 0 ? "+" : ""
        return `${sign}${entry.quantity} × ${entry.item_id}`
      }
      if (entry.type === "product_grant") {
        return `Grant ${entry.quantity} × ${entry.product?.display_name ?? entry.product_id ?? "product"}`
      }
      if (entry.type === "product_revocation") {
        return `Revoke ${entry.quantity}`
      }
      return entry.type
    })
    .join(" • ")
}

function SessionReplaysTab({
  user,
  onClose,
}: {
  user: ServerUser
  onClose: () => void
}) {
  const adminApp = useAdminApp()
  const navigate = useNavigate()
  const list = useUserSessionReplaysInfinite(adminApp, user, ROW_HEIGHT)

  return (
    <VirtualizedListPanel
      list={list}
      getItemKey={(replay) => replay.id}
      emptyMessage="No session replays recorded for this user."
      errorPrefix="Failed to load session replays"
      renderRow={(replay) => {
        const startedAt = new Date(replay.startedAt)
        const lastEventAt = new Date(replay.lastEventAt)
        const durationMs = Math.max(
          0,
          lastEventAt.getTime() - startedAt.getTime()
        )
        return (
          <button
            type="button"
            onClick={() => {
              onClose()
              void navigate({
                to: "/projects/$projectId/session-replays/$sessionId",
                params: {
                  projectId: adminApp.projectId,
                  sessionId: replay.id,
                },
              })
            }}
            className="flex h-full w-full items-start gap-3 border-b bg-card px-3 py-2 text-left transition-colors hover:bg-muted/50 hover:transition-none"
          >
            <UserCircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {replay.id}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {replay.eventCount} events • {replay.chunkCount} chunks •{" "}
                {formatDurationMs(durationMs)}
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {formatRecentDashboardDate(startedAt)}
            </span>
          </button>
        )
      }}
    />
  )
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}
