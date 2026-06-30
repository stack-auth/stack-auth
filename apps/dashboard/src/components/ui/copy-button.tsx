"use client";

import { cn } from "@/lib/utils";
import { CheckIcon, CopyIcon, SparkleIcon } from "@phosphor-icons/react";
import { forwardRefIfNeeded } from "@hexclave/shared/dist/utils/react";
import React from "react";
import { Button, type ButtonProps } from "./button";
import { useToast } from "./use-toast";

const CopyButton = forwardRefIfNeeded<
  HTMLButtonElement,
  ButtonProps & { content: string, initialCopied?: boolean }
>(({ content, initialCopied, ...props }, ref) => {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  const resetTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showCopied = React.useCallback(() => {
    setCopied(true);
    if (resetTimeout.current != null) clearTimeout(resetTimeout.current);
    resetTimeout.current = setTimeout(() => setCopied(false), 2000);
  }, []);

  React.useEffect(() => () => {
    if (resetTimeout.current != null) clearTimeout(resetTimeout.current);
  }, []);

  // Reflect a copy that already happened elsewhere (e.g. the snippet was
  // auto-copied to the clipboard when this field was rendered).
  React.useEffect(() => {
    if (initialCopied) showCopied();
  }, [initialCopied, showCopied]);

  return (
    <Button
      variant="secondary"
      {...props}
      className={cn("h-6 w-6 p-1", props.className)}
      ref={ref}
      onClick={async (...args) => {
        await props.onClick?.(...args);
        try {
          await navigator.clipboard.writeText(content);
          showCopied();
        } catch (e) {
          toast({ description: 'Failed to copy to clipboard', variant: 'destructive' });
        }
      }}
    >
      {copied ? <CheckIcon className="text-green-500 dark:text-green-400" weight="bold" /> : <CopyIcon />}
    </Button>
  );
});
CopyButton.displayName = "CopyButton";

const CopyPromptButton = forwardRefIfNeeded<
  HTMLButtonElement,
  ButtonProps & { content: string }
>(({ content, children, onClick, ...props }, ref) => {
  const { toast } = useToast();

  return (
    <Button
      variant="secondary"
      {...props}
      ref={ref}
      onClick={async (...args) => {
        await onClick?.(...args);
        try {
          await navigator.clipboard.writeText(content);
          toast({ description: 'Prompt copied — paste it into your AI agent', variant: 'success' });
        } catch (e) {
          toast({ description: 'Failed to copy to clipboard', variant: 'destructive' });
        }
      }}
    >
      {children ?? <SparkleIcon className="text-purple-500 dark:text-purple-400" />}
    </Button>
  );
});
CopyPromptButton.displayName = "CopyPromptButton";

export { CopyButton, CopyPromptButton };
