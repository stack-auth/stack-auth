"use client";

import { cn } from "@/lib/utils";
import { CopyIcon } from "@phosphor-icons/react";
import { forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";
import React from "react";
import { Button } from "./button";
import { useToast } from "./use-toast";

const CopyButton = forwardRefIfNeeded<
  React.ElementRef<typeof Button>,
  React.ComponentProps<typeof Button> & { content: string }
>((props, ref) => {
  const { toast } = useToast();

  return (
    <Button
      variant="secondary"
      {...props}
      className={cn("h-6 w-6 p-1", props.className)}
      ref={ref}
      onClick={async (...args) => {
        await props.onClick?.(...args);
        try {
          await navigator.clipboard.writeText(props.content);
          toast({ description: 'Copied to clipboard!', variant: 'success' });
        } catch (e) {
          toast({ description: 'Failed to copy to clipboard', variant: 'destructive' });
        }
      }}
    >
      <CopyIcon />
    </Button>
  );
});
CopyButton.displayName = "CopyButton";

export { CopyButton };

