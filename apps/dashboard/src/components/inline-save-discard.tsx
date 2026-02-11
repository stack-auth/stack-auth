"use client";

import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { useAsyncCallback } from "@stackframe/stack-shared/dist/hooks/use-async-callback";
import { Button, cn } from "./ui";

/**
 * Inline Save/Discard buttons component for settings sections.
 * Shows Save and Discard buttons when hasChanges is true, with smooth animation.
 */
export function InlineSaveDiscard({
  hasChanges,
  onSave,
  onDiscard,
  className,
}: {
  hasChanges: boolean,
  onSave: () => Promise<void>,
  onDiscard: () => void,
  className?: string,
}) {
  const [handleSave, isSaving] = useAsyncCallback(onSave, [onSave]);

  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 transition-all duration-200 ease-out",
        hasChanges ? "opacity-100 max-h-10 mt-3" : "opacity-0 max-h-0 overflow-hidden mt-0",
        className
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={onDiscard}
        disabled={isSaving}
        className="text-xs h-7 px-2"
      >
        <XIcon className="h-3 w-3 mr-1" />
        Discard
      </Button>
      <Button
        size="sm"
        onClick={handleSave}
        disabled={isSaving}
        className="text-xs h-7 px-3"
      >
        <CheckIcon className="h-3 w-3 mr-1" />
        Save changes
      </Button>
    </div>
  );
}

