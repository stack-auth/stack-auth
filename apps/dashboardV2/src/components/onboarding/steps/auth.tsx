import {
  EnvelopeIcon,
  GithubLogoIcon,
  GlobeIcon,
  GoogleLogoIcon,
  LockSimpleIcon,
  MagicWandIcon,
  WindowsLogoIcon,
} from "@phosphor-icons/react"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import type { AdminOwnedProject } from "@stackframe/tanstack-start"

import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export type AuthState = {
  credential: boolean,
  magicLink: boolean,
  passkey: boolean,
  google: boolean,
  github: boolean,
  microsoft: boolean,
}

type ProviderId = "google" | "github" | "microsoft"

type Provider = {
  id: ProviderId,
  label: string,
  Icon: PhosphorIcon,
}

const OAUTH_PROVIDERS: Array<Provider> = [
  { id: "google", label: "Google", Icon: GoogleLogoIcon },
  { id: "github", label: "GitHub", Icon: GithubLogoIcon },
  { id: "microsoft", label: "Microsoft", Icon: WindowsLogoIcon },
]

type AuthStepProps = {
  project: AdminOwnedProject,
  displayName: string,
  value: AuthState,
  onChange: (next: AuthState) => void,
}

export function AuthStep({ displayName, value, onChange }: AuthStepProps) {
  const set = <TKey extends keyof AuthState>(key: TKey, v: AuthState[TKey]) =>
    onChange({ ...value, [key]: v })

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Step 3
        </p>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Configure authentication
        </h2>
        <p className="text-sm text-muted-foreground">
          Pick the sign-in methods you want enabled. The preview updates as you
          toggle methods.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="space-y-3">
            <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              Email-based
            </p>
            <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
              <SwitchRow
                id="credential"
                label="Email & password"
                description="Classic password-based sign-in."
                checked={value.credential}
                onCheckedChange={(c) => set("credential", c)}
              />
              <SwitchRow
                id="magic-link"
                label="Magic link / OTP"
                description="One-time codes and email magic links."
                checked={value.magicLink}
                onCheckedChange={(c) => set("magicLink", c)}
                divider
              />
              <SwitchRow
                id="passkey"
                label="Passkey"
                description="Passwordless WebAuthn passkeys."
                checked={value.passkey}
                onCheckedChange={(c) => set("passkey", c)}
                divider
              />
            </div>
          </section>

          <section className="space-y-3">
            <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              OAuth providers
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {OAUTH_PROVIDERS.map((p) => {
                const checked = value[p.id]
                const Icon = p.Icon
                return (
                  <label
                    key={p.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg bg-card px-3 py-3 ring-1 transition-colors",
                      checked
                        ? "ring-primary/40 bg-primary/5"
                        : "ring-foreground/10 hover:ring-foreground/20",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => set(p.id, next === true)}
                    />
                    <Icon className="size-4 text-muted-foreground" weight="duotone" />
                    <span className="text-sm font-medium">{p.label}</span>
                  </label>
                )
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Uses Stack&apos;s shared OAuth keys. You can swap in your own
              credentials later.
            </p>
          </section>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-3 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            Preview
          </p>
          <SignInPreview value={value} projectName={displayName} />
        </div>
      </div>
    </div>
  )
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  divider,
}: {
  id: string,
  label: string,
  description: string,
  checked: boolean,
  onCheckedChange: (checked: boolean) => void,
  divider?: boolean,
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 bg-card px-4 py-3",
        divider && "border-t",
      )}
    >
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function SignInPreview({
  value,
  projectName,
}: {
  value: AuthState,
  projectName: string,
}) {
  const trimmedName = projectName.trim() || "your app"
  const initial = (trimmedName[0] || "A").toUpperCase()
  const providers = OAUTH_PROVIDERS.filter((p) => value[p.id])
  const hasEmail = value.credential || value.magicLink
  const hasPasskey = value.passkey
  const nothingEnabled = !hasEmail && providers.length === 0 && !hasPasskey

  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10 bg-muted/30">
      {/* minimal browser frame */}
      <div className="flex items-center gap-2 border-b border-foreground/5 px-3 py-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-md bg-background/60 px-2 py-1 ring-1 ring-foreground/5">
          <GlobeIcon className="size-3 text-muted-foreground" />
          <span className="truncate text-[10px] text-muted-foreground">
            your-app.com/sign-in
          </span>
        </div>
      </div>

      <div className="px-6 py-8">
        <div className="mx-auto max-w-[300px] rounded-lg bg-background p-6 ring-1 ring-foreground/10">
          <div className="mb-5 flex flex-col items-center gap-3 text-center">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 font-heading text-sm font-semibold text-primary">
              {initial}
            </div>
            <div className="space-y-0.5">
              <h3 className="font-heading text-sm font-semibold tracking-tight">
                Sign in to {trimmedName}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Continue to your account
              </p>
            </div>
          </div>

          {nothingEnabled && (
            <div className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-[11px] text-muted-foreground">
              Enable at least one method to see a sign-in form.
            </div>
          )}

          {providers.length > 0 && (
            <div className="space-y-2">
              {providers.map((p) => {
                const Icon = p.Icon
                return (
                  <div
                    key={p.id}
                    className="flex h-9 items-center justify-center gap-2 rounded-md bg-background px-3 text-[11px] font-medium ring-1 ring-foreground/10"
                  >
                    <Icon className="size-3.5" weight="duotone" />
                    Continue with {p.label}
                  </div>
                )
              })}
            </div>
          )}

          {providers.length > 0 && (hasEmail || hasPasskey) && (
            <div className="my-4 flex items-center gap-3 text-[10px] tracking-wider text-muted-foreground uppercase">
              <div className="h-px flex-1 bg-border" />
              or
              <div className="h-px flex-1 bg-border" />
            </div>
          )}

          {hasEmail && (
            <div className="space-y-2">
              <PreviewInput icon={EnvelopeIcon} placeholder="you@example.com" />
              {value.credential && (
                <PreviewInput icon={LockSimpleIcon} placeholder="••••••••" />
              )}
              {value.credential && (
                <PreviewPrimaryButton label="Sign in" />
              )}
              {value.magicLink && !value.credential && (
                <PreviewPrimaryButton label="Send magic link" Icon={MagicWandIcon} />
              )}
              {value.magicLink && value.credential && (
                <div className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-background px-3 text-[11px] font-medium ring-1 ring-foreground/10">
                  <MagicWandIcon className="size-3.5" />
                  Email me a magic link
                </div>
              )}
            </div>
          )}

          {hasPasskey && !hasEmail && providers.length === 0 && (
            <PreviewPrimaryButton label="Sign in with passkey" />
          )}

          {hasPasskey && (hasEmail || providers.length > 0) && (
            <div className="mt-2 text-center text-[10px] text-muted-foreground">
              Or sign in with a passkey
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PreviewInput({
  icon: Icon,
  placeholder,
}: {
  icon: PhosphorIcon,
  placeholder: string,
}) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-md bg-input/20 px-2.5 text-[11px] text-muted-foreground ring-1 ring-foreground/10">
      <Icon className="size-3.5" />
      {placeholder}
    </div>
  )
}

function PreviewPrimaryButton({
  label,
  Icon,
}: {
  label: string,
  Icon?: PhosphorIcon,
}) {
  return (
    <div className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground">
      {Icon ? <Icon className="size-3.5" /> : null}
      {label}
    </div>
  )
}
