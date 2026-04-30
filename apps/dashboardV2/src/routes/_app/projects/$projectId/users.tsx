import { useCallback, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  CheckIcon,
  CopyIcon,
  EnvelopeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  UserPlusIcon,
  UsersIcon,
} from "@phosphor-icons/react"
import type { ServerUser } from "@stackframe/tanstack-start"

import { cn } from "@/lib/utils"
import { useInfiniteVirtualList } from "@/hooks/use-infinite-virtual-list"
import { useAdminApp } from "@/lib/stack/admin-app"
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

const PAGE_SIZE = 20
const USERS_QUERY_GC_TIME_MS = 2 * 60 * 1000

export const Route = createFileRoute("/_app/projects/$projectId/users")({
  component: UsersPage,
})

const ROW_HEIGHT = 64
const COLUMN_GRID_CLASS =
  "grid grid-cols-[minmax(12rem,2fr)_minmax(10rem,2fr)_minmax(7rem,1fr)_minmax(7rem,1fr)] items-center gap-4 px-4"

function UsersPage() {
  const adminApp = useAdminApp()

  const [query, setQuery] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  const queryKey = useMemo(
    () => ["users-list", adminApp.projectId] as const,
    [adminApp.projectId],
  )
  const getSelectedUserIndex = useCallback((users: ReadonlyArray<ServerUser>) => {
    if (selectedUserId == null) return null

    const selectedIndex = users.findIndex((user) => user.id === selectedUserId)
    return selectedIndex === -1 ? null : selectedIndex
  }, [selectedUserId])
  const getSelectableUserIndexes = useCallback((users: ReadonlyArray<ServerUser>) => {
    const q = query.trim().toLowerCase()
    const indexes: Array<number> = []

    users.forEach((user, index) => {
      if (q.length === 0) {
        indexes.push(index)
        return
      }

      const email = user.primaryEmail?.toLowerCase() ?? ""
      const name = user.displayName?.toLowerCase() ?? ""
      if (email.includes(q) || name.includes(q)) indexes.push(index)
    })

    return indexes
  }, [query])

  const {
    parentRef,
    virtualizer,
    items,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
  } = useInfiniteVirtualList<ServerUser, string>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const page = await adminApp.listUsers({ limit: PAGE_SIZE, cursor: pageParam })
      return { items: [...page], nextCursor: page.nextCursor }
    },
    estimateSize: ROW_HEIGHT,
    gcTime: USERS_QUERY_GC_TIME_MS,
    keyboardNavigation: {
      enabled: !createOpen,
      getSelectedIndex: getSelectedUserIndex,
      onSelectedItemChange: (user) => setSelectedUserId(user.id),
      selectableIndexes: getSelectableUserIndexes,
    },
  })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return items
    return items.filter((u) => {
      const email = u.primaryEmail?.toLowerCase() ?? ""
      const name = u.displayName?.toLowerCase() ?? ""
      return email.includes(q) || name.includes(q)
    })
  }, [items, query])

  const filteredIds = useMemo(() => new Set(filtered.map((u) => u.id)), [filtered])

  const selectedUser = selectedUserId == null
    ? null
    : items.find((u) => u.id === selectedUserId) ?? null

  const isEmpty = !isLoading && items.length === 0 && !hasNextPage
  const virtualItems = virtualizer.getVirtualItems()
  const isSearching = query.trim().length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-[52px] w-full max-w-6xl items-center justify-between gap-3 px-6">
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-base font-semibold tracking-tight">
              Users
            </h1>
            <Badge variant="secondary">{items.length.toLocaleString()}</Badge>
          </div>
          <Button size="lg" onClick={() => setCreateOpen(true)}>
            <UserPlusIcon />
            New user
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col px-6 py-8">
        {isEmpty ? (
          <UsersEmpty onCreate={() => setCreateOpen(true)} />
        ) : (
          <>
            <div className="mb-6 flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <MagnifyingGlassIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name or email"
                  className="ps-8"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {filtered.length} of {items.length}
              </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
              <div
                className={cn(
                  COLUMN_GRID_CLASS,
                  "h-10 border-b bg-muted/30 font-mono text-[10px] tracking-wider text-muted-foreground uppercase",
                )}
              >
                <span>User</span>
                <span>Email</span>
                <span>Signed up</span>
                <span>Last active</span>
              </div>
              {isSearching && filtered.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No users match "{query}".
                </p>
              ) : (
                <div
                  ref={parentRef}
                  className="relative min-h-0 flex-1 overflow-auto"
                >
                  <div
                    className="relative w-full"
                    style={{ height: `${virtualizer.getTotalSize()}px` }}
                  >
                    {virtualItems.map((row) => {
                      const isLoaderRow = row.index >= items.length
                      const item = isLoaderRow ? null : items[row.index]
                      const matches = item != null && (!isSearching || filteredIds.has(item.id))
                      return (
                        <div
                          key={isLoaderRow ? `__loader_${row.index}` : item!.id}
                          data-index={row.index}
                          ref={virtualizer.measureElement}
                          className={cn(
                            "absolute left-0 top-0 w-full",
                            !isLoaderRow && !matches && "hidden",
                          )}
                          style={{ transform: `translateY(${row.start}px)` }}
                        >
                          {isLoaderRow ? (
                            <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                              {isFetchingNextPage || hasNextPage ? "Loading more…" : null}
                            </div>
                          ) : (
                            <UserRow
                              user={item!}
                              selected={selectedUserId === item!.id}
                              onSelect={(u) => setSelectedUserId(u.id)}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />

      <UserDetailSheet
        user={selectedUser}
        open={selectedUser != null}
        onOpenChange={(o) => {
          if (!o) setSelectedUserId(null)
        }}
      />
    </div>
  )
}

function UserRow({
  user,
  selected,
  onSelect,
}: {
  user: ServerUser,
  selected: boolean,
  onSelect: (user: ServerUser) => void,
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(user)}
      className={cn(
        COLUMN_GRID_CLASS,
        "h-16 w-full items-center border-b text-left transition-colors hover:bg-muted/50 hover:transition-none",
        selected && "bg-muted/70",
      )}
      aria-current={selected ? "true" : undefined}
    >
      <div className="flex items-center gap-2 min-w-0">
        <UserAvatar user={user} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {user.displayName ?? (
              <span className="text-muted-foreground">No name</span>
            )}
          </p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {user.id.slice(0, 8)}
          </p>
        </div>
      </div>
      <span className="truncate text-sm">
        {user.primaryEmail ?? (
          <span className="text-muted-foreground">—</span>
        )}
      </span>
      <span className="truncate text-sm text-muted-foreground">
        {formatShortDate(user.signedUpAt)}
      </span>
      <span className="truncate text-sm text-muted-foreground">
        {formatShortDate(user.lastActiveAt)}
      </span>
    </button>
  )
}

function UserAvatar({ user }: { user: ServerUser }) {
  const initial = user.displayName?.trim().charAt(0)
    ?? user.primaryEmail?.trim().charAt(0)
    ?? "?"
  return (
    <Avatar>
      {user.profileImageUrl == null ? null : (
        <AvatarImage src={user.profileImageUrl} alt={user.displayName ?? user.id} />
      )}
      <AvatarFallback>{initial.toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}

function UsersEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid place-items-center py-16">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon />
          </EmptyMedia>
          <EmptyTitle>No users yet</EmptyTitle>
          <EmptyDescription>
            Users sign up through your app's auth pages, or you can create one
            manually for testing.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onCreate}>
            <PlusIcon />
            New user
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
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
      // SDK: createUser(options: ServerUserCreateOptions): Promise<ServerUser>
      await adminApp.createUser({
        primaryEmail: primaryEmail.trim(),
        displayName: displayName.trim() === "" ? undefined : displayName.trim(),
        password: password === "" ? undefined : password,
        primaryEmailAuthEnabled: password === "" ? undefined : true,
      })
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

function UserDetailSheet({
  user,
  open,
  onOpenChange,
}: {
  user: ServerUser | null,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const adminApp = useAdminApp()
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        className="w-[min(56rem,calc(100vw-1rem))] !max-w-[56rem]"
        showOverlay={false}
      >
        {user == null ? null : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3">
                <UserAvatar user={user} />
                <div className="min-w-0">
                  <p className="truncate font-heading text-sm font-medium">
                    {user.displayName ?? user.primaryEmail ?? user.id}
                  </p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {user.id}
                  </p>
                </div>
              </SheetTitle>
              <SheetDescription>
                {user.primaryEmail ?? "No primary email"}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-6">
              <section className="space-y-3">
                <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Identity
                </h3>
                <DetailRow label="User ID">
                  <CopyableId value={user.id} />
                </DetailRow>
                <DetailRow label="Display name">
                  <span className="text-sm">
                    {user.displayName ?? (
                      <span className="text-muted-foreground">No name</span>
                    )}
                  </span>
                </DetailRow>
                <DetailRow label="Primary email">
                  <span className="text-sm">
                    {user.primaryEmail ?? (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </span>
                </DetailRow>
                <DetailRow label="Email verified">
                  <Badge variant={user.primaryEmailVerified ? "default" : "secondary"}>
                    {user.primaryEmailVerified ? "Verified" : "Unverified"}
                  </Badge>
                </DetailRow>
              </section>

              <section className="space-y-3">
                <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Auth
                </h3>
                <DetailRow label="Has password">
                  <Badge variant={user.hasPassword ? "default" : "secondary"}>
                    {user.hasPassword ? "Yes" : "No"}
                  </Badge>
                </DetailRow>
                <DetailRow label="OTP enabled">
                  <Badge variant={user.otpAuthEnabled ? "default" : "secondary"}>
                    {user.otpAuthEnabled ? "Yes" : "No"}
                  </Badge>
                </DetailRow>
                <DetailRow label="Anonymous">
                  <Badge variant={user.isAnonymous ? "default" : "secondary"}>
                    {user.isAnonymous ? "Yes" : "No"}
                  </Badge>
                </DetailRow>
                <DetailRow label="Restricted">
                  <Badge variant={user.restrictedByAdmin ? "destructive" : "secondary"}>
                    {user.restrictedByAdmin ? "Yes" : "No"}
                  </Badge>
                </DetailRow>
              </section>

              <section className="space-y-3">
                <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Activity
                </h3>
                <DetailRow label="Signed up">
                  <span className="text-sm">{formatLongDate(user.signedUpAt)}</span>
                </DetailRow>
                <DetailRow label="Last active">
                  <span className="text-sm">{formatLongDate(user.lastActiveAt)}</span>
                </DetailRow>
              </section>

              <section className="space-y-2">
                <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Actions
                </h3>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const email = user.primaryEmail
                      if (email == null) {
                        toast.error("This user has no primary email.")
                        return
                      }
                      // SDK: sendForgotPasswordEmail(email: string, options?): Promise<Result<undefined, KnownErrors["UserNotFound"]>>
                      const result = await adminApp.sendForgotPasswordEmail(email)
                      if (result.status === "ok") {
                        toast.success(`Password reset email sent to ${email}.`)
                      } else {
                        toast.error(`Failed to send: ${result.error.message}`)
                      }
                    }}
                  >
                    <EnvelopeIcon />
                    Send password reset
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      // SDK: ServerBaseUser.update({ restrictedByAdmin?: boolean, ... })
                      await user.update({ restrictedByAdmin: !user.restrictedByAdmin })
                      toast.success(
                        user.restrictedByAdmin ? "User unrestricted." : "User restricted."
                      )
                    }}
                  >
                    {user.restrictedByAdmin ? "Unrestrict user" : "Restrict user"}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setConfirmDeleteOpen(true)}
                  >
                    <TrashIcon />
                    Delete user
                  </Button>
                </div>
              </section>
            </div>

            <DeleteUserDialog
              user={user}
              open={confirmDeleteOpen}
              onOpenChange={setConfirmDeleteOpen}
              onDeleted={() => {
                setConfirmDeleteOpen(false)
                onOpenChange(false)
              }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function DeleteUserDialog({
  user,
  open,
  onOpenChange,
  onDeleted,
}: {
  user: ServerUser,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onDeleted: () => void,
}) {
  const [confirmText, setConfirmText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The user might not have an email; fall back to user id for the confirm token.
  const confirmTarget = user.primaryEmail ?? user.id
  const canDelete = confirmText === confirmTarget

  const handleDelete = async () => {
    if (!canDelete) return
    setSubmitting(true)
    setError(null)
    try {
      // SDK: UserExtra.delete(): Promise<void>
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

function DetailRow({
  label,
  children,
}: {
  label: string,
  children: React.ReactNode,
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-3">
      <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
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
    </div>
  )
}

function formatShortDate(date: Date | null): string {
  if (date == null) return "—"
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatLongDate(date: Date | null): string {
  if (date == null) return "—"
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
