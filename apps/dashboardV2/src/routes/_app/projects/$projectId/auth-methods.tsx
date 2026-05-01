import * as React from "react"
import { useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  AsteriskIcon,
  DotsThreeVerticalIcon,
  KeyIcon,
  LinkIcon,
  PlusIcon,
  ShieldCheckIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

import { AuthPage } from "@stackframe/tanstack-start"
import { BrandIcons } from "@stackframe/stack-ui"
import { allProviders } from "@stackframe/stack-shared/dist/utils/oauth"
import type { ProviderType } from "@stackframe/stack-shared/dist/utils/oauth"
import type { AdminProject } from "@stackframe/tanstack-start"
import type { RestrictedReason } from "@stackframe/stack-shared/dist/schema-fields"

import type { ProviderEntryMap } from "@/components/projects/auth-methods/provider-dialog"
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

import { AddProvidersDialog } from "@/components/projects/auth-methods/add-providers-dialog"
import {
  ConfigureProviderDialog,
  
  ProviderIcon
} from "@/components/projects/auth-methods/provider-dialog"

export const Route = createFileRoute("/_app/projects/$projectId/auth-methods")({
  component: AuthMethodsPage,
})

type AffectedUser = {
  id: string,
  displayName: string | null,
  primaryEmail: string | null,
  restrictedReason: RestrictedReason,
}

type MergeStrategy = "link_method" | "raise_error" | "allow_duplicates"

function AuthMethodsPage() {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const config = useLoadedAdminProjectConfig(project)

  const passwordEnabled: boolean = config.auth.password.allowSignIn
  const otpEnabled: boolean = config.auth.otp.allowSignIn
  const passkeyEnabled: boolean = config.auth.passkey.allowSignIn
  const signUpEnabled: boolean = config.auth.allowSignUp
  const mergeStrategy: MergeStrategy = config.auth.oauth.accountMergeStrategy
  const requireEmailVerification: boolean = config.onboarding.requireEmailVerification
  const allowClientUserDeletion: boolean = config.users.allowClientUserDeletion
  const providers: ProviderEntryMap = config.auth.oauth.providers

  const enabledProviderIds = useMemo(
    () =>
      (allProviders as ReadonlyArray<ProviderType>).filter(
        (id) => providers[id]?.allowSignIn === true,
      ),
    [providers],
  )

  const enabledMethodCount =
    (passwordEnabled ? 1 : 0) + (otpEnabled ? 1 : 0) + (passkeyEnabled ? 1 : 0)
  const configuredProviderCount = enabledProviderIds.filter(
    (id) => providers[id]?.isShared !== true && (providers[id]?.clientId ?? "") !== "",
  ).length
  const sharedProviderCount = enabledProviderIds.filter(
    (id) => providers[id]?.isShared === true,
  ).length

  return (
    <ProjectPage>
      <ProjectPageHeader
        title="Auth methods"
        badge={(
          <span className="text-xs text-muted-foreground">
            {enabledMethodCount} method{enabledMethodCount === 1 ? "" : "s"}
            {" · "}
            {enabledProviderIds.length} provider{enabledProviderIds.length === 1 ? "" : "s"}
            {sharedProviderCount > 0 ? ` (${sharedProviderCount} shared)` : ""}
            {configuredProviderCount > 0 ? ` · ${configuredProviderCount} configured` : ""}
          </span>
        )}
      />

      <ProjectPageMain className="flex flex-col gap-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          <MethodsAndProvidersCard
            project={project}
            passwordEnabled={passwordEnabled}
            otpEnabled={otpEnabled}
            passkeyEnabled={passkeyEnabled}
            providers={providers}
            enabledProviderIds={enabledProviderIds}
          />
          <PreviewPane
            project={project}
            passwordEnabled={passwordEnabled}
            otpEnabled={otpEnabled}
            passkeyEnabled={passkeyEnabled}
            signUpEnabled={signUpEnabled}
            enabledProviderIds={enabledProviderIds}
          />
        </div>

        <SignUpCard
          project={project}
          adminApp={adminApp}
          signUpEnabled={signUpEnabled}
          mergeStrategy={mergeStrategy}
          requireEmailVerification={requireEmailVerification}
        />

        <UserDeletionCard
          project={project}
          allowClientUserDeletion={allowClientUserDeletion}
        />
      </ProjectPageMain>
    </ProjectPage>
  )
}

// --------------- methods + providers ---------------

function MethodsAndProvidersCard({
  project,
  passwordEnabled,
  otpEnabled,
  passkeyEnabled,
  providers,
  enabledProviderIds,
}: {
  project: AdminProject,
  passwordEnabled: boolean,
  otpEnabled: boolean,
  passkeyEnabled: boolean,
  providers: ProviderEntryMap,
  enabledProviderIds: ReadonlyArray<ProviderType>,
}) {
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()
  const [addOpen, setAddOpen] = useState(false)
  const [configureId, setConfigureId] = useState<ProviderType | null>(null)
  const [disableConfirm, setDisableConfirm] = useState<ProviderType | null>(null)

  const writeFlag = async (path: string, next: boolean, label: string) => {
    try {
      await project.updateConfig({ [path]: next })
      await invalidateProjectConfig(project.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to update ${label}.`)
    }
  }

  const disableProvider = async (id: ProviderType) => {
    try {
      await project.updateConfig({
        [`auth.oauth.providers.${id}.allowSignIn`]: false,
        [`auth.oauth.providers.${id}.allowConnectedAccounts`]: false,
      })
      await invalidateProjectConfig(project.id)
      toast.success(`${BrandIcons.toTitle(id)} disabled.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to disable ${id}.`)
    }
  }

  return (
    <Card className="self-start overflow-hidden">
      <CardHeader>
        <CardTitle>Sign-in methods</CardTitle>
        <CardDescription>
          Toggle methods and connect SSO providers. Saved instantly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="divide-y divide-border rounded-md border border-border bg-card/50">
          <MethodRow
            id="password"
            icon={<AsteriskIcon className="size-4" />}
            label="Email + password"
            hint="Classic password-based sign-in."
            checked={passwordEnabled}
            onChange={(next) => writeFlag("auth.password.allowSignIn", next, "email/password")}
          />
          <MethodRow
            id="otp"
            icon={<LinkIcon className="size-4" />}
            label="Magic link / OTP"
            hint="Email-based one-time codes and magic links."
            checked={otpEnabled}
            onChange={(next) => writeFlag("auth.otp.allowSignIn", next, "magic link")}
          />
          <MethodRow
            id="passkey"
            icon={<KeyIcon className="size-4" />}
            label="Passkey"
            hint="Passwordless sign-in with WebAuthn."
            checked={passkeyEnabled}
            onChange={(next) => writeFlag("auth.passkey.allowSignIn", next, "passkey")}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-heading text-xs font-medium tracking-tight">
              SSO providers
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {enabledProviderIds.length === 0
                ? "Click a tile below to connect."
                : `${enabledProviderIds.length} active`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {enabledProviderIds.map((id) => {
              const entry = providers[id]
              const isShared = entry?.isShared === true
              const needsConfig = !isShared && (entry?.clientId == null || entry.clientId === "")
              return (
                <ProviderTile
                  key={id}
                  providerId={id}
                  isShared={isShared}
                  needsConfig={needsConfig}
                  onConfigure={() => setConfigureId(id)}
                  onDisable={() => setDisableConfirm(id)}
                />
              )
            })}

            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="group relative flex aspect-[1.4] flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-transparent p-3 text-center transition-colors hover:border-primary/60 hover:bg-accent/30"
            >
              <div className="flex size-8 items-center justify-center rounded-md bg-muted/40 text-muted-foreground ring-1 ring-foreground/10 transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                <PlusIcon className="size-4" />
              </div>
              <span className="text-xs font-medium">Add provider</span>
            </button>
          </div>
        </div>
      </CardContent>

      <AddProvidersDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        project={project}
        providers={providers}
        onConfigureStandard={(id) => setConfigureId(id)}
      />

      {configureId != null ? (
        <ConfigureProviderDialog
          open
          onOpenChange={(o) => {
            if (!o) setConfigureId(null)
          }}
          project={project}
          providerId={configureId}
          entry={providers[configureId]}
        />
      ) : null}

      <AlertDialog
        open={disableConfirm != null}
        onOpenChange={(o) => {
          if (!o) setDisableConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disable {disableConfirm ? BrandIcons.toTitle(disableConfirm) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Existing users who signed up with this provider may not be able to sign in anymore. You can re-enable it later — credentials are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const id = disableConfirm
                setDisableConfirm(null)
                if (id != null) await disableProvider(id)
              }}
            >
              Disable provider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function MethodRow({
  id,
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string,
  icon: React.ReactNode,
  label: string,
  hint: string,
  checked: boolean,
  onChange: (next: boolean) => Promise<void> | void,
}) {
  const [pending, setPending] = useState<boolean | null>(null)
  const display = pending ?? checked

  const handle = async (next: boolean) => {
    setPending(next)
    try {
      await onChange(next)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md ring-1 transition-colors",
          display
            ? "bg-primary/15 text-primary ring-primary/30"
            : "bg-muted/40 text-muted-foreground ring-foreground/10",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="cursor-pointer text-xs font-medium">
          {label}
        </Label>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <Switch
        id={id}
        checked={display}
        onCheckedChange={(next) => void handle(next)}
      />
    </div>
  )
}

function ProviderTile({
  providerId,
  isShared,
  needsConfig,
  onConfigure,
  onDisable,
}: {
  providerId: ProviderType,
  isShared: boolean,
  needsConfig: boolean,
  onConfigure: () => void,
  onDisable: () => void,
}) {
  return (
    <div className="group relative flex aspect-[1.4] flex-col items-center justify-center gap-1.5 rounded-md border border-border bg-card p-3 text-center transition-colors hover:border-primary/40 hover:bg-accent/30">
      <button
        type="button"
        onClick={onConfigure}
        className="absolute inset-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        aria-label={`Configure ${BrandIcons.toTitle(providerId)}`}
      />
      <ProviderIcon providerId={providerId} size={32} />
      <span className="text-xs font-medium leading-tight">
        {BrandIcons.toTitle(providerId)}
      </span>
      {needsConfig ? (
        <span className="flex items-center gap-1 text-[10px] text-destructive">
          <WarningIcon className="size-2.5" /> Needs setup
        </span>
      ) : isShared ? (
        <span className="text-[10px] text-muted-foreground">Shared keys</span>
      ) : (
        <span className="text-[10px] text-muted-foreground">Custom keys</span>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${providerId} actions`}
              className="absolute end-1 top-1 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <DotsThreeVerticalIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onConfigure}>Configure</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDisable}>
            Disable
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// --------------- preview ---------------

function PreviewPane({
  project,
  passwordEnabled,
  otpEnabled,
  passkeyEnabled,
  signUpEnabled,
  enabledProviderIds,
}: {
  project: AdminProject,
  passwordEnabled: boolean,
  otpEnabled: boolean,
  passkeyEnabled: boolean,
  signUpEnabled: boolean,
  enabledProviderIds: ReadonlyArray<ProviderType>,
}) {
  const [tab, setTab] = useState<"sign-in" | "sign-up">("sign-in")

  const mockProject = useMemo(
    () => ({
      config: {
        signUpEnabled,
        credentialEnabled: passwordEnabled,
        passkeyEnabled,
        magicLinkEnabled: otpEnabled,
        oauthProviders: enabledProviderIds.map((id) => ({ id })),
      },
    }),
    [signUpEnabled, passwordEnabled, passkeyEnabled, otpEnabled, enabledProviderIds],
  )

  // Reference project to keep the type sound (the SDK's hook is what makes
  // the AuthPage render under the right StackProvider scope at runtime).
  void project

  return (
    <Card className="hidden overflow-hidden lg:flex lg:flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-sm">Live preview</CardTitle>
          <CardDescription>How the auth page looks to users.</CardDescription>
        </div>
        <div className="inline-flex rounded-md bg-muted p-0.5 ring-1 ring-foreground/10">
          <button
            type="button"
            onClick={() => setTab("sign-in")}
            className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
              tab === "sign-in"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setTab("sign-up")}
            className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
              tab === "sign-up"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Sign up
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <BrowserFrame url={`your-app.com/handler/${tab}`}>
          <div className="flex items-center justify-center px-4 py-6">
            <div className="pointer-events-none relative w-full max-w-[280px]">
              <div className="absolute inset-0 z-10 bg-transparent" />
              <AuthPage type={tab} mockProject={mockProject} />
            </div>
          </div>
        </BrowserFrame>
      </CardContent>
    </Card>
  )
}

function BrowserFrame({ url, children }: { url: string, children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
      <div className="flex h-8 items-center gap-2 border-b border-foreground/10 bg-muted/40 px-3">
        <span className="size-2 rounded-full bg-red-400/70" />
        <span className="size-2 rounded-full bg-yellow-400/70" />
        <span className="size-2 rounded-full bg-green-400/70" />
        <div
          aria-hidden
          className="ms-2 flex h-5 flex-1 items-center overflow-hidden rounded-full bg-background px-2.5 text-[10px] text-muted-foreground"
        >
          <span className="truncate">{url}</span>
        </div>
      </div>
      <div className="relative bg-background">{children}</div>
    </div>
  )
}

// --------------- sign-up card ---------------

type AdminAppLike = ReturnType<typeof useAdminApp>

function SignUpCard({
  project,
  adminApp,
  signUpEnabled,
  mergeStrategy,
  requireEmailVerification,
}: {
  project: AdminProject,
  adminApp: AdminAppLike,
  signUpEnabled: boolean,
  mergeStrategy: MergeStrategy,
  requireEmailVerification: boolean,
}) {
  const [signUpConfirm, setSignUpConfirm] = useState<{ next: boolean } | null>(null)
  const [pendingSignUp, setPendingSignUp] = useState<boolean | null>(null)
  const [pendingMerge, setPendingMerge] = useState<MergeStrategy | null>(null)
  const [pendingEmailVerify, setPendingEmailVerify] = useState<boolean | null>(null)
  const [emailVerifyConfirm, setEmailVerifyConfirm] = useState<{
    affectedUsers: Array<AffectedUser>,
    totalAffectedCount: number,
  } | null>(null)
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()

  const signUpDisplay = pendingSignUp ?? signUpEnabled
  const mergeDisplay = pendingMerge ?? mergeStrategy
  const emailVerifyDisplay = pendingEmailVerify ?? requireEmailVerification

  const applySignUp = async (next: boolean) => {
    setPendingSignUp(next)
    try {
      await project.updateConfig({ "auth.allowSignUp": next })
      await invalidateProjectConfig(project.id)
      toast.success(next ? "Sign-up enabled." : "Sign-up disabled.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update sign-up.")
    } finally {
      setPendingSignUp(null)
    }
  }

  const applyMerge = async (next: MergeStrategy) => {
    setPendingMerge(next)
    try {
      await project.updateConfig({ "auth.oauth.accountMergeStrategy": next })
      await invalidateProjectConfig(project.id)
      toast.success("Merge strategy updated.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update merge strategy.")
    } finally {
      setPendingMerge(null)
    }
  }

  const applyEmailVerify = async (next: boolean) => {
    setPendingEmailVerify(next)
    try {
      await project.updateConfig({ "onboarding.requireEmailVerification": next })
      await invalidateProjectConfig(project.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update email verification.")
    } finally {
      setPendingEmailVerify(null)
    }
  }

  const handleEmailVerifyToggle = async (next: boolean) => {
    if (next && !requireEmailVerification) {
      setPendingEmailVerify(next)
      try {
        const preview = await adminApp.previewAffectedUsersByOnboardingChange(
          { requireEmailVerification: true },
          10,
        )
        if (preview.totalAffectedCount > 0) {
          setEmailVerifyConfirm({
            affectedUsers: preview.affectedUsers,
            totalAffectedCount: preview.totalAffectedCount,
          })
          setPendingEmailVerify(null)
          return
        }
      } catch (err) {
        setPendingEmailVerify(null)
        toast.error(err instanceof Error ? err.message : "Failed to preview affected users.")
        return
      }
      setPendingEmailVerify(null)
    }
    await applyEmailVerify(next)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-up</CardTitle>
        <CardDescription>
          Control who can create new accounts and how identities are merged.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border [&>*]:py-4 [&>:first-child]:pt-0 [&>:last-child]:pb-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Label htmlFor="allow-signup" className="text-xs font-medium">
              Allow new user sign-ups
            </Label>
            <p className="text-[11px] text-muted-foreground">
              When disabled, only existing users can sign in. New accounts can still be created manually from the dashboard.
            </p>
          </div>
          <Switch
            id="allow-signup"
            checked={signUpDisplay}
            onCheckedChange={(next) => setSignUpConfirm({ next })}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Label htmlFor="email-verify" className="flex items-center gap-2 text-xs font-medium">
              <ShieldCheckIcon className="size-3.5 text-muted-foreground" />
              Require email verification
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Users must verify their primary email before using your application. Requires SDK ≥ 2.8.57.
            </p>
          </div>
          <Switch
            id="email-verify"
            checked={emailVerifyDisplay}
            disabled={pendingEmailVerify != null}
            onCheckedChange={(next) => void handleEmailVerifyToggle(next)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="merge-strategy" className="text-xs font-medium">
            OAuth merge strategy
          </Label>
          <p className="text-[11px] text-muted-foreground">
            What happens when a user signs in with a different OAuth provider that has the same email as an existing account.
          </p>
          <Select
            value={mergeDisplay}
            onValueChange={(value) => {
              if (typeof value !== "string") return
              const v = value
              if (v !== mergeDisplay) void applyMerge(v)
            }}
          >
            <SelectTrigger id="merge-strategy" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="link_method">
                Link — connect multiple providers to one account
              </SelectItem>
              <SelectItem value="allow_duplicates">
                Allow — separate accounts per provider
              </SelectItem>
              <SelectItem value="raise_error">
                Block — show an error and prevent sign-in
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>

      <AlertDialog
        open={signUpConfirm != null}
        onOpenChange={(o) => {
          if (!o) setSignUpConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {signUpConfirm?.next ? "Enable sign-up?" : "Disable sign-up?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {signUpConfirm?.next
                ? "Anyone will be able to create an account on your project."
                : "Only existing users will be able to sign in. New accounts can still be created manually from the dashboard."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const next = signUpConfirm?.next ?? false
                setSignUpConfirm(null)
                await applySignUp(next)
              }}
            >
              {signUpConfirm?.next ? "Enable sign-up" : "Disable sign-up"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={emailVerifyConfirm != null}
        onOpenChange={(o) => {
          if (!o) setEmailVerifyConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable email verification?</AlertDialogTitle>
            <AlertDialogDescription>
              {emailVerifyConfirm
                ? `${emailVerifyConfirm.totalAffectedCount} existing user${emailVerifyConfirm.totalAffectedCount === 1 ? "" : "s"} will need to verify their email next time they visit your app.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {emailVerifyConfirm && emailVerifyConfirm.affectedUsers.length > 0 ? (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto">
              {emailVerifyConfirm.affectedUsers.map((u) => (
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
              {emailVerifyConfirm.totalAffectedCount > emailVerifyConfirm.affectedUsers.length ? (
                <li className="text-xs text-muted-foreground">
                  + {emailVerifyConfirm.totalAffectedCount - emailVerifyConfirm.affectedUsers.length} more
                </li>
              ) : null}
            </ul>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                setEmailVerifyConfirm(null)
                await applyEmailVerify(true)
              }}
            >
              Enable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// --------------- user deletion ---------------

function UserDeletionCard({
  project,
  allowClientUserDeletion,
}: {
  project: AdminProject,
  allowClientUserDeletion: boolean,
}) {
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()
  const [pending, setPending] = useState<boolean | null>(null)
  const display = pending ?? allowClientUserDeletion

  const apply = async (next: boolean) => {
    setPending(next)
    try {
      await project.updateConfig({ "users.allowClientUserDeletion": next })
      await invalidateProjectConfig(project.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update user deletion.")
    } finally {
      setPending(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>User deletion</CardTitle>
        <CardDescription>
          Decide whether your users can delete their own accounts from the client.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Label htmlFor="allow-deletion" className="text-xs font-medium">
              Allow client-side account deletion
            </Label>
            <p className="text-[11px] text-muted-foreground">
              When enabled, a delete button appears in the SDK&apos;s account settings page.
            </p>
          </div>
          <Switch
            id="allow-deletion"
            checked={display}
            onCheckedChange={(next) => void apply(next)}
          />
        </div>
      </CardContent>
    </Card>
  )
}

// --------------- util ---------------

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}
