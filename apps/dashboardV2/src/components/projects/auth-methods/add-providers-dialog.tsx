import { useMemo, useState } from "react"
import { toast } from "sonner"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"

import { BrandIcons } from "@stackframe/stack-ui"
import { allProviders, sharedProviders } from "@stackframe/stack-shared/dist/utils/oauth"
import { ProviderIcon } from "./provider-dialog"
import type { ProviderEntryMap } from "./provider-dialog"
import type { ProviderType } from "@stackframe/stack-shared/dist/utils/oauth"
import type { AdminProject } from "@stackframe/tanstack-start"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useStackAuthQueryInvalidation } from "@/lib/stack/react-query"


const SHARED_PROVIDERS = new Set<string>(sharedProviders)

export function AddProvidersDialog({
  open,
  onOpenChange,
  project,
  providers,
  onConfigureStandard,
}: {
  open: boolean,
  onOpenChange: (nextOpen: boolean) => void,
  project: AdminProject,
  providers: ProviderEntryMap,
  onConfigureStandard: (id: ProviderType) => void,
}) {
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()
  const [search, setSearch] = useState("")

  const disabled = useMemo(() => {
    return (allProviders as ReadonlyArray<ProviderType>)
      .filter((id) => {
        const entry = providers[id]
        // Show if not present at all, or present but with allowSignIn=false
        return !entry || entry.allowSignIn !== true
      })
      .filter((id) => {
        if (search.trim() === "") return true
        const q = search.toLowerCase()
        return (
          id.toLowerCase().includes(q) ||
          BrandIcons.toTitle(id).toLowerCase().includes(q)
        )
      })
  }, [providers, search])

  const handleClick = async (id: ProviderType) => {
    const supportsShared = SHARED_PROVIDERS.has(id)
    const entry = providers[id]
    if (supportsShared && (!entry || entry.isShared !== false)) {
      // Fast-path: enable with shared keys
      try {
        await project.updateConfig({
          [`auth.oauth.providers.${id}`]: {
            type: id,
            isShared: true,
            allowSignIn: true,
            allowConnectedAccounts: true,
          },
        })
        await invalidateProjectConfig(project.id)
        toast.success(`${BrandIcons.toTitle(id)} enabled with shared keys.`)
        onOpenChange(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Failed to enable ${id}.`)
      }
      return
    }
    // Provider doesn't support shared, or already has standard config — open dialog
    onOpenChange(false)
    onConfigureStandard(id)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add SSO providers</DialogTitle>
          <DialogDescription>
            Click a provider to enable it. Providers with shared keys are enabled instantly; others open a configuration dialog.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <MagnifyingGlassIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search providers…"
            className="ps-8"
          />
        </div>

        {disabled.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No more providers available.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {disabled.map((id) => {
              const supportsShared = SHARED_PROVIDERS.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => void handleClick(id)}
                  className="group flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-3 text-center transition-colors hover:border-primary/50 hover:bg-accent/30"
                >
                  <ProviderIcon providerId={id} size={36} />
                  <div className="flex min-w-0 flex-col items-center gap-0.5">
                    <span className="text-xs font-medium">{BrandIcons.toTitle(id)}</span>
                    {supportsShared ? (
                      <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                        Shared keys
                      </Badge>
                    ) : (
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
                        Configure
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
