"use client";

import { DesignAlert } from "@/components/design-components/alert";
import { DesignButton } from "@/components/design-components/button";

export function PreviewFlowError({ onRetry }: { onRetry: () => void | Promise<void> }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <DesignAlert
          variant="error"
          title="Preview unavailable"
          description="We couldn't load the preview right now. Please try again."
          className="text-left"
        />
        <DesignButton variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </DesignButton>
      </div>
    </div>
  );
}
