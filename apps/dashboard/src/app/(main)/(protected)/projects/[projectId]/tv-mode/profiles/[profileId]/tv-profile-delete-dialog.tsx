"use client";

import { Typography } from "@/components/ui";
import { ActionDialog } from "@/components/ui/action-dialog";

export function TvProfileDeleteDialog({
  open,
  onOpenChange,
  profileName,
  onConfirm,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  profileName: string,
  onConfirm: () => Promise<void>,
}) {
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete TV profile"
      description="This action cannot be undone."
      danger
      cancelButton
      okButton={{
        label: "Delete",
        onClick: onConfirm,
      }}
    >
      <Typography>
        Delete the profile <span className="font-semibold text-foreground">&ldquo;{profileName}&rdquo;</span>?
        Its playlist, timing, privacy, and interruption settings will be permanently removed.
      </Typography>
    </ActionDialog>
  );
}
