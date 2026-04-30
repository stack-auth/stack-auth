import * as React from "react"
import { useState } from "react"
import { toast } from "sonner"
import { sharedProviders } from "@stackframe/stack-shared/dist/utils/oauth"
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors"
import type { allProviders } from "@stackframe/stack-shared/dist/utils/oauth"
import type { AdminProject } from "@stackframe/tanstack-start"

const SHARED_PROVIDERS = new Set<string>(sharedProviders)

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  microsoft: "Microsoft",
  spotify: "Spotify",
  facebook: "Facebook",
  discord: "Discord",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  linkedin: "LinkedIn",
  apple: "Apple",
  x: "X (Twitter)",
  twitch: "Twitch",
}

export type ProviderType = (typeof allProviders)[number]

export type ProviderEntry = {
  type?: ProviderType,
  isShared?: boolean,
  clientId?: string,
  clientSecret?: string,
  allowSignIn?: boolean,
  allowConnectedAccounts?: boolean,
}

export function useAuthProviderRow({
  project,
  providerId,
  entry,
}: {
  project: AdminProject,
  providerId: ProviderType,
  entry: ProviderEntry | undefined,
}) {
  const enabled = entry?.allowSignIn === true
  const supportsShared = SHARED_PROVIDERS.has(providerId)
  const isShared = entry?.isShared === true && supportsShared

  // Local form state (only used while editing). We never reflect the
  // persisted clientSecret back into the input, so once saved the field
  // clears because the secret is write-only from the dashboard's perspective.
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const [showSecret, setShowSecret] = useState(false)
  const [useShared, setUseShared] = useState(isShared)
  const [editing, setEditing] = useState(false)

  // Sync the "use shared" toggle when the persisted state changes
  // (e.g. another tab edits, or after save).
  React.useEffect(() => {
    setUseShared(isShared)
  }, [isShared])

  const label = PROVIDER_LABELS[providerId] ?? providerId

  const handleToggle = async (next: boolean) => {
    if (!next) {
      // Disable: drop allowSignIn (and connected-accounts), keep credentials
      // around in case the operator wants to re-enable later. The schema
      // treats `allowSignIn=false` as "configured but off".
      await project.updateConfig({
        [`auth.oauth.providers.${providerId}.allowSignIn`]: false,
        [`auth.oauth.providers.${providerId}.allowConnectedAccounts`]: false,
      })
      setEditing(false)
      return
    }

    // Enable. If the provider supports shared keys and we have no entry yet,
    // start in shared mode for fast onboarding. Otherwise enable as standard
    // (which will require credentials to actually work).
    if (entry == null) {
      if (supportsShared) {
        await project.updateConfig({
          [`auth.oauth.providers.${providerId}`]: {
            type: providerId,
            isShared: true,
            allowSignIn: true,
            allowConnectedAccounts: true,
          },
        })
      } else {
        await project.updateConfig({
          [`auth.oauth.providers.${providerId}`]: {
            type: providerId,
            isShared: false,
            allowSignIn: true,
            allowConnectedAccounts: true,
          },
        })
        setEditing(true)
      }
    } else {
      await project.updateConfig({
        [`auth.oauth.providers.${providerId}.allowSignIn`]: true,
        [`auth.oauth.providers.${providerId}.allowConnectedAccounts`]: true,
      })
    }
  }

  const handleSave = async () => {
    if (useShared) {
      if (!supportsShared) {
        throwErr(
          `Provider ${providerId} does not support shared keys but useShared was true; this is a UI bug.`,
        )
      }
      await project.updateConfig({
        [`auth.oauth.providers.${providerId}.isShared`]: true,
        [`auth.oauth.providers.${providerId}.clientId`]: null,
        [`auth.oauth.providers.${providerId}.clientSecret`]: null,
      })
      setClientId("")
      setClientSecret("")
      setEditing(false)
      toast.success(`${label} updated.`)
      return
    }

    const trimmedId = clientId.trim()
    if (trimmedId === "") {
      toast.error("Client ID is required for standard mode.")
      return
    }
    if (clientSecret.trim() === "") {
      toast.error("Client secret is required for standard mode.")
      return
    }

    await project.updateConfig({
      [`auth.oauth.providers.${providerId}.isShared`]: false,
      [`auth.oauth.providers.${providerId}.clientId`]: trimmedId,
      [`auth.oauth.providers.${providerId}.clientSecret`]: clientSecret,
    })
    // Clear the secret out of the DOM after persistence.
    setClientSecret("")
    setShowSecret(false)
    setEditing(false)
    toast.success(`${label} credentials saved.`)
  }

  const resetForm = () => {
    setClientId("")
    setClientSecret("")
    setShowSecret(false)
    setUseShared(isShared)
    setEditing(false)
  }

  const dirty =
    useShared !== isShared || clientId.trim() !== "" || clientSecret !== ""

  return {
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
  }
}
