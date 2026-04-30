import { createFileRoute } from "@tanstack/react-router"
import {
  EyeIcon,
  EyeSlashIcon,
  GlobeIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react"

import { allProviders } from "@stackframe/stack-shared/dist/utils/oauth"
import type { AdminProject } from "@stackframe/tanstack-start"

import type { ProviderEntry, ProviderType } from "@/hooks/projects/use-auth-provider-row"
import { useAuthMethodRow } from "@/hooks/projects/use-auth-method-row"
import { useAuthProviderRow } from "@/hooks/projects/use-auth-provider-row"
import { useToggleWithError } from "@/hooks/projects/use-toggle-with-error"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useAdminApp } from "@/lib/stack/admin-app"

export const Route = createFileRoute("/_app/projects/$projectId/auth-methods")({
  component: AuthMethodsPage,
})

// ----- page -----

function AuthMethodsPage() {
  const adminApp = useAdminApp()
  // adminApp.useProject() is declared as AdminProject in the admin-app
  // interface, but the intersection with the server-app's overload widens
  // it to Project. The runtime override (admin-app-impl.ts) returns an
  // AdminProject, so this re-narrowing reflects reality. Documented in the
  // SDK at packages/template/src/lib/stack-app/apps/implementations/admin-app-impl.ts:333.
  const project: AdminProject = adminApp.useProject()
  const config = project.useConfig()

  return (
    <div className="flex flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-[52px] w-full max-w-5xl items-center justify-between gap-3 px-6">
          <h1 className="font-heading text-base font-semibold tracking-tight">
            Auth methods
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-6 py-8">
        <MethodsCard
          project={project}
          credentialEnabled={config.auth.password.allowSignIn}
          magicLinkEnabled={config.auth.otp.allowSignIn}
          passkeyEnabled={config.auth.passkey.allowSignIn}
          signUpEnabled={config.auth.allowSignUp}
        />

        <OAuthCard
          project={project}
          providers={config.auth.oauth.providers}
        />
      </main>
    </div>
  )
}

// ----- methods card -----

type MethodsCardProps = {
  project: AdminProject,
  credentialEnabled: boolean,
  magicLinkEnabled: boolean,
  passkeyEnabled: boolean,
  signUpEnabled: boolean,
}

function MethodsCard({
  project,
  credentialEnabled,
  magicLinkEnabled,
  passkeyEnabled,
  signUpEnabled,
}: MethodsCardProps) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-sm font-medium tracking-tight">
        Methods
      </h2>
      <Card>
        <CardHeader>
          <CardTitle>Sign-in methods</CardTitle>
          <CardDescription>
            Toggle the authentication methods available to your users. Each
            change is persisted immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <MethodRow
            id="credentialEnabled"
            label="Email + password"
            description="Classic password-based sign-in."
            checked={credentialEnabled}
            onChange={async (next) => {
              await project.updateConfig({
                "auth.password.allowSignIn": next,
              })
            }}
          />
          <MethodRow
            id="magicLinkEnabled"
            label="Magic link / OTP"
            description="Email-based one-time codes and magic links."
            checked={magicLinkEnabled}
            onChange={async (next) => {
              await project.updateConfig({ "auth.otp.allowSignIn": next })
            }}
          />
          <MethodRow
            id="passkeyEnabled"
            label="Passkey"
            description="Passwordless sign-in via WebAuthn passkeys."
            checked={passkeyEnabled}
            onChange={async (next) => {
              await project.updateConfig({
                "auth.passkey.allowSignIn": next,
              })
            }}
          />
          <MethodRow
            id="signUpEnabled"
            label="Sign-up enabled"
            description="If disabled, only existing users can sign in."
            checked={signUpEnabled}
            onChange={async (next) => {
              await project.updateConfig({ "auth.allowSignUp": next })
            }}
          />
        </CardContent>
      </Card>
    </section>
  )
}

function MethodRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string,
  label: string,
  description: string,
  checked: boolean,
  onChange: (next: boolean) => Promise<void>,
}) {
  const { display, handle } = useAuthMethodRow({ checked, label, onChange })

  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={display}
        onCheckedChange={(next) => handle(next)}
      />
    </div>
  )
}

// ----- oauth card -----

function OAuthCard({
  project,
  providers,
}: {
  project: AdminProject,
  providers: Record<string, ProviderEntry>,
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-sm font-medium tracking-tight">
        OAuth providers
      </h2>
      <Card>
        <CardHeader>
          <CardTitle>Connected providers</CardTitle>
          <CardDescription>
            Enable third-party identity providers for sign-in. For providers
            that support shared keys, you can use Stack&apos;s development
            credentials before configuring your own.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {allProviders.map((id) => (
            <OAuthProviderRow
              key={id}
              project={project}
              providerId={id}
              entry={providers[id]}
            />
          ))}
        </CardContent>
      </Card>
    </section>
  )
}

function OAuthProviderRow({
  project,
  providerId,
  entry,
}: {
  project: AdminProject,
  providerId: ProviderType,
  entry: ProviderEntry | undefined,
}) {
  const {
    clientId,
    setClientId,
    clientSecret,
    setClientSecret,
    showSecret,
    setShowSecret,
    useShared,
    setUseShared,
    editing,
    setEditing,
    enabled,
    supportsShared,
    isShared,
    label,
    handleToggle,
    handleSave,
    resetForm,
    dirty,
  } = useAuthProviderRow({ project, providerId, entry })

  return (
    <div className="space-y-3 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <ProviderChip providerId={providerId} label={label} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="truncate text-xs font-medium">{label}</p>
          {enabled && isShared ? (
            <span className="rounded-sm bg-warning/15 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-warning uppercase">
              Shared
            </span>
          ) : null}
          {enabled && !isShared && entry?.clientId != null ? (
            <span className="rounded-sm bg-success/15 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-success uppercase">
              Configured
            </span>
          ) : null}
        </div>
        {enabled ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Close" : "Configure"}
          </Button>
        ) : null}
        <ToggleWithError
          ariaLabel={`Enable ${label}`}
          checked={enabled}
          onChange={handleToggle}
          fallback={`Failed to update ${label}.`}
        />
      </div>

      {enabled && editing ? (
        <div className="space-y-3 rounded-md bg-muted/30 p-3 ring-1 ring-foreground/10">
          {supportsShared ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Label
                  htmlFor={`${providerId}-shared`}
                  className="text-xs font-medium"
                >
                  Use shared keys
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Stack&apos;s development credentials. Replace before going
                  to production.
                </p>
              </div>
              <Switch
                id={`${providerId}-shared`}
                checked={useShared}
                onCheckedChange={(next) => setUseShared(next)}
              />
            </div>
          ) : null}

          {!useShared ? (
            <>
              <div className="space-y-1.5">
                <Label
                  htmlFor={`${providerId}-client-id`}
                  className="text-xs font-medium"
                >
                  Client ID
                </Label>
                <Input
                  id={`${providerId}-client-id`}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder={
                    entry?.clientId != null && entry.clientId !== ""
                      ? `Currently set (…${entry.clientId.slice(-4)})`
                      : "Required"
                  }
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor={`${providerId}-client-secret`}
                  className="text-xs font-medium"
                >
                  Client secret
                </Label>
                <div className="relative">
                  <Input
                    id={`${providerId}-client-secret`}
                    type={showSecret ? "text" : "password"}
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={
                      entry?.clientSecret != null && entry.clientSecret !== ""
                        ? "•••••••• (set — enter new value to replace)"
                        : "Required"
                    }
                    autoComplete="new-password"
                    className="pe-8"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute end-1 top-1/2 -translate-y-1/2"
                    aria-label={
                      showSecret ? "Hide client secret" : "Show client secret"
                    }
                    onClick={() => setShowSecret((v) => !v)}
                  >
                    {showSecret ? <EyeSlashIcon /> : <EyeIcon />}
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetForm}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dirty}
              onClick={handleSave}
            >
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ToggleWithError({
  checked,
  onChange,
  ariaLabel,
  fallback,
}: {
  checked: boolean,
  onChange: (next: boolean) => Promise<void>,
  ariaLabel: string,
  fallback: string,
}) {
  const { display, handle } = useToggleWithError({ checked, onChange, fallback })

  return (
    <Switch
      aria-label={ariaLabel}
      checked={display}
      onCheckedChange={(next) => handle(next)}
    />
  )
}

function ProviderChip({
  providerId,
  label,
}: {
  providerId: ProviderType,
  label: string,
}) {
  // Phosphor doesn't ship brand glyphs; we render a labeled chip with the
  // first two letters of the provider id, plus a generic globe/shield icon
  // to give the row a stable visual anchor. (No `as` casts on icon refs.)
  const Icon = providerId === "apple" ? ShieldCheckIcon : GlobeIcon
  const initials = providerId.slice(0, 2).toUpperCase()
  return (
    <div
      className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"
      aria-hidden
      title={label}
    >
      <span className="font-mono text-[10px] font-semibold tracking-wider">
        {initials}
      </span>
      <Icon className="sr-only" />
    </div>
  )
}
