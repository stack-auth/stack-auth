import * as React from "react"
import { useState } from "react"
import { toast } from "sonner"
import {
  ArrowSquareOutIcon,
  EyeIcon,
  EyeSlashIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react"

import { BrandIcons } from "@stackframe/stack-ui"
import { sharedProviders } from "@stackframe/stack-shared/dist/utils/oauth"
import type { ProviderType } from "@stackframe/stack-shared/dist/utils/oauth"
import type { AdminProject } from "@stackframe/tanstack-start"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { useStackAuthQueryInvalidation } from "@/lib/stack/react-query"

const SHARED_PROVIDERS = new Set<string>(sharedProviders)

const SHARED_TOOLTIP =
  "Shared keys are created by Stack for development. They show Stack's logo on the OAuth screen and should not be used in production."

export type ProviderEntry = {
  type?: string,
  isShared?: boolean,
  clientId?: string,
  clientSecret?: string,
  facebookConfigId?: string,
  microsoftTenantId?: string,
  appleBundles?: Record<string, { bundleId: string }>,
  allowSignIn?: boolean,
  allowConnectedAccounts?: boolean,
}

export type ProviderEntryMap = Partial<Record<ProviderType, ProviderEntry>>

export function ProviderIcon({
  providerId,
  size = 40,
}: {
  providerId: string,
  size?: number,
}) {
  const bg = (BrandIcons.BRAND_COLORS)[providerId]
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-md ring-1 ring-foreground/10"
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
      }}
    >
      <BrandIcons.Mapping iconSize={Math.round(size * 0.55)} provider={providerId} />
    </div>
  )
}

export function ConfigureProviderDialog({
  open,
  onOpenChange,
  project,
  providerId,
  entry,
  onSaved,
}: {
  open: boolean,
  onOpenChange: (nextOpen: boolean) => void,
  project: AdminProject,
  providerId: ProviderType,
  entry: ProviderEntry | undefined,
  onSaved?: () => void,
}) {
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()
  const supportsShared = SHARED_PROVIDERS.has(providerId)
  const wasShared = entry?.isShared === true && supportsShared
  const label = BrandIcons.toTitle(providerId)

  const [useShared, setUseShared] = useState<boolean>(wasShared || (!entry && supportsShared))
  const [clientId, setClientId] = useState<string>(entry?.clientId ?? "")
  const [clientSecret, setClientSecret] = useState<string>("")
  const [showSecret, setShowSecret] = useState(false)
  const [facebookConfigId, setFacebookConfigId] = useState<string>(entry?.facebookConfigId ?? "")
  const [microsoftTenantId, setMicrosoftTenantId] = useState<string>(entry?.microsoftTenantId ?? "")
  const [appleBundleInput, setAppleBundleInput] = useState<string>("")
  const initialBundles = React.useMemo(() => {
    if (!entry?.appleBundles) return [] as Array<string>
    return Object.values(entry.appleBundles).map((b) => b.bundleId)
  }, [entry?.appleBundles])
  const [appleBundles, setAppleBundles] = useState<Array<string>>(initialBundles)
  const [saving, setSaving] = useState(false)

  // Reset internal state whenever the entry identity changes (i.e. dialog reopened)
  React.useEffect(() => {
    if (open) {
      setUseShared(wasShared || (!entry && supportsShared))
      setClientId(entry?.clientId ?? "")
      setClientSecret("")
      setShowSecret(false)
      setFacebookConfigId(entry?.facebookConfigId ?? "")
      setMicrosoftTenantId(entry?.microsoftTenantId ?? "")
      setAppleBundles(initialBundles)
      setAppleBundleInput("")
    }
  }, [open])

  const handleSave = async () => {
    setSaving(true)
    try {
      if (useShared) {
        if (!supportsShared) {
          toast.error(`${label} does not support shared keys.`)
          return
        }
        await project.updateConfig({
          [`auth.oauth.providers.${providerId}`]: {
            type: providerId,
            isShared: true,
            clientId: null,
            clientSecret: null,
            facebookConfigId: null,
            microsoftTenantId: null,
            appleBundles: null,
            allowSignIn: true,
            allowConnectedAccounts: true,
          },
        })
        await invalidateProjectConfig(project.id)
      } else {
        const trimmedId = clientId.trim()
        if (trimmedId === "") {
          toast.error("Client ID is required.")
          return
        }
        const isFirstStandardSetup = !entry || entry.isShared === true
        if (isFirstStandardSetup && clientSecret.trim() === "") {
          toast.error("Client secret is required.")
          return
        }
        const update: Record<string, any> = {
          [`auth.oauth.providers.${providerId}.type`]: providerId,
          [`auth.oauth.providers.${providerId}.isShared`]: false,
          [`auth.oauth.providers.${providerId}.clientId`]: trimmedId,
          [`auth.oauth.providers.${providerId}.allowSignIn`]: true,
          [`auth.oauth.providers.${providerId}.allowConnectedAccounts`]: true,
        }
        if (clientSecret.trim() !== "") {
          update[`auth.oauth.providers.${providerId}.clientSecret`] = clientSecret
        }
        if (providerId === "facebook") {
          update[`auth.oauth.providers.${providerId}.facebookConfigId`] =
            facebookConfigId.trim() === "" ? null : facebookConfigId.trim()
        }
        if (providerId === "microsoft") {
          update[`auth.oauth.providers.${providerId}.microsoftTenantId`] =
            microsoftTenantId.trim() === "" ? null : microsoftTenantId.trim()
        }
        if (providerId === "apple") {
          if (appleBundles.length === 0) {
            update[`auth.oauth.providers.${providerId}.appleBundles`] = null
          } else {
            const bundlesRecord: Record<string, { bundleId: string }> = {}
            appleBundles.forEach((bundleId, i) => {
              bundlesRecord[`bundle-${i}-${bundleId.replace(/[^a-zA-Z0-9_-]/g, "_")}`] = { bundleId }
            })
            update[`auth.oauth.providers.${providerId}.appleBundles`] = bundlesRecord
          }
        }
        await project.updateConfig(update)
        await invalidateProjectConfig(project.id)
      }
      toast.success(`${label} saved.`)
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to save ${label}.`)
    } finally {
      setSaving(false)
    }
  }

  const addAppleBundle = () => {
    const v = appleBundleInput.trim()
    if (v === "") return
    if (appleBundles.includes(v)) {
      setAppleBundleInput("")
      return
    }
    setAppleBundles([...appleBundles, v])
    setAppleBundleInput("")
  }

  const docsId = providerId === "x" ? "x-twitter" : providerId
  const callbackUrl = `${getStackApiUrl()}/api/v1/auth/oauth/callback/${providerId}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ProviderIcon providerId={providerId} size={28} />
            <span>{label} OAuth provider</span>
            {useShared && supportsShared ? (
              <Badge variant="secondary" title={SHARED_TOOLTIP}>
                Shared
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            Configure {label} sign-in for your project. Existing accounts are transferred when keys change.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {supportsShared ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Label htmlFor={`${providerId}-shared`} className="text-xs font-medium">
                  Use shared keys
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Stack&apos;s development credentials. Replace before production.
                </p>
              </div>
              <Switch
                id={`${providerId}-shared`}
                checked={useShared}
                onCheckedChange={(next) => setUseShared(next)}
              />
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              This provider does not support shared keys. You must supply your own credentials.
            </p>
          )}

          {!useShared ? (
            <>
              <div className="space-y-1.5 rounded-md bg-muted/30 p-3 ring-1 ring-foreground/10">
                <Label className="text-xs font-medium">Redirect URL</Label>
                <p className="break-all font-mono text-[11px] text-muted-foreground">{callbackUrl}</p>
                <p className="text-[11px] text-muted-foreground">
                  Use this in the {label} provider console.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${providerId}-client-id`} className="text-xs font-medium">
                  {providerId === "apple" ? "Service ID (Client ID)" : "Client ID"}
                </Label>
                <Input
                  id={`${providerId}-client-id`}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Required"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${providerId}-client-secret`} className="text-xs font-medium">
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
                        ? "Leave blank to keep existing"
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
                    aria-label={showSecret ? "Hide client secret" : "Show client secret"}
                    onClick={() => setShowSecret((v) => !v)}
                  >
                    {showSecret ? <EyeSlashIcon /> : <EyeIcon />}
                  </Button>
                </div>
              </div>

              {providerId === "facebook" ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`${providerId}-fb-config`} className="text-xs font-medium">
                    Configuration ID
                  </Label>
                  <Input
                    id={`${providerId}-fb-config`}
                    value={facebookConfigId}
                    onChange={(e) => setFacebookConfigId(e.target.value)}
                    placeholder="Optional, only required for Facebook Business"
                  />
                </div>
              ) : null}

              {providerId === "microsoft" ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`${providerId}-ms-tenant`} className="text-xs font-medium">
                    Tenant ID
                  </Label>
                  <Input
                    id={`${providerId}-ms-tenant`}
                    value={microsoftTenantId}
                    onChange={(e) => setMicrosoftTenantId(e.target.value)}
                    placeholder="Required when using your organizational directory"
                  />
                </div>
              ) : null}

              {providerId === "apple" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Bundle IDs</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Required for native iOS/macOS Sign in with Apple. Press Enter to add.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={appleBundleInput}
                      onChange={(e) => setAppleBundleInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault()
                          addAppleBundle()
                        }
                      }}
                      placeholder="com.example.myiosapp"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={addAppleBundle}>
                      <PlusIcon /> Add
                    </Button>
                  </div>
                  {appleBundles.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {appleBundles.map((b) => (
                        <Badge key={b} variant="secondary" className="gap-1 pe-1">
                          <span className="font-mono">{b}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setAppleBundles(appleBundles.filter((x) => x !== b))
                            }
                            className="rounded-sm p-0.5 hover:bg-foreground/10"
                            aria-label={`Remove ${b}`}
                          >
                            <XIcon className="size-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {providerId === "github" ? (
                <p className="text-[11px] text-muted-foreground">
                  GitHub apps must be public with read-only email permissions enabled.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {SHARED_TOOLTIP}
            </p>
          )}

          <a
            href={`https://docs.stack-auth.com/docs/concepts/auth-providers/${docsId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-3 hover:text-foreground hover:underline"
          >
            See {label} setup docs <ArrowSquareOutIcon className="size-3" />
          </a>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function getStackApiUrl(): string {
  // The dashboardV2 builds with Vite. NEXT_PUBLIC_STACK_API_URL is the
  // canonical name across the repo's apps; fall back to the current origin
  // so the dialog still renders something useful in stripped envs.
  const envUrl =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_STACK_API_URL
      : undefined
  if (envUrl) return envUrl
  if (typeof window !== "undefined") return window.location.origin
  return ""
}
