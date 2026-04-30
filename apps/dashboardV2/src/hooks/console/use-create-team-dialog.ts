import { useState } from "react"
import { useUser } from "@stackframe/tanstack-start"
import { fileToBase64 } from "@stackframe/stack-shared/dist/utils/base64"
import { toast } from "sonner"
import type { ChangeEvent, FormEvent } from "react"

export type CreatedTeam = {
  id: string,
  displayName: string,
}

export type UseCreateTeamDialogOptions = {
  onOpenChange: (open: boolean) => void,
  onCreated?: (team: CreatedTeam) => void,
}

export function useCreateTeamDialog({
  onOpenChange,
  onCreated,
}: UseCreateTeamDialogOptions) {
  const user = useUser({ or: "redirect" })
  const [displayName, setDisplayName] = useState("")
  const [profileImageUrl, setProfileImageUrl] = useState("")
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setDisplayName("")
    setProfileImageUrl("")
    setError(null)
  }

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("File must be an image.")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be smaller than 5MB.")
      return
    }
    setUploading(true)
    setError(null)
    try {
      const dataUrl = await fileToBase64(file)
      setProfileImageUrl(dataUrl)
    } catch {
      setError("Failed to read image.")
    } finally {
      setUploading(false)
    }
  }

  const clearProfileImage = () => setProfileImageUrl("")

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const name = displayName.trim()
    if (name.length < 2) {
      setError("Display name must be at least 2 characters.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const team = await user.createTeam({
        displayName: name,
        profileImageUrl: profileImageUrl.trim() || undefined,
      })
      toast.success("Team created")
      onCreated?.({ id: team.id, displayName: team.displayName })
      reset()
      onOpenChange(false)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create team."
      toast.error(message)
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  return {
    displayName,
    setDisplayName,
    profileImageUrl,
    setProfileImageUrl,
    handleFileChange,
    clearProfileImage,
    uploading,
    submitting,
    error,
    handleOpenChange,
    handleSubmit,
  }
}
