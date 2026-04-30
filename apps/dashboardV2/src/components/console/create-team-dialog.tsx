import { useRef } from "react"
import { TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import type { ChangeEvent } from "react"
import type {CreatedTeam} from "@/hooks/console/use-create-team-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { Spinner } from "@/components/ui/spinner"
import {  useCreateTeamDialog } from "@/hooks/console/use-create-team-dialog"

type CreateTeamDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onCreated?: (team: CreatedTeam) => void,
}

export function CreateTeamDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateTeamDialogProps) {
  const {
    displayName,
    setDisplayName,
    profileImageUrl,
    handleFileChange,
    clearProfileImage,
    uploading,
    submitting,
    error,
    handleOpenChange,
    handleSubmit,
  } = useCreateTeamDialog({ onOpenChange, onCreated })

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const initial = displayName.trim().charAt(0).toUpperCase() || "T"
  const busy = submitting || uploading

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create a new team</DialogTitle>
            <DialogDescription>
              Teams group members and resources. You can invite people after
              creating it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>
                Profile image{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <div className="flex items-center gap-3">
                <Avatar size="lg">
                  {profileImageUrl ? (
                    <AvatarImage src={profileImageUrl} alt="Team logo" />
                  ) : null}
                  <AvatarFallback>{initial}</AvatarFallback>
                </Avatar>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    void handleFileChange(e)
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                >
                  {uploading ? <Spinner /> : <UploadSimpleIcon />}
                  {profileImageUrl ? "Change" : "Upload"}
                </Button>
                {profileImageUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearProfileImage}
                    disabled={busy}
                  >
                    <TrashIcon />
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-team-name">Display name</Label>
              <Input
                id="create-team-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Engineering"
                autoFocus
                required
                minLength={2}
                disabled={submitting}
              />
            </div>
            {error != null ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {submitting ? <Spinner /> : null}
              Create team
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
