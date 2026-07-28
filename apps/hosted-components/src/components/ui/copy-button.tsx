import { forwardRefIfNeeded } from "@hexclave/shared/dist/utils/react";
import { Check, Copy } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import { Button, type ButtonProps } from "./button";
import { cn } from "./utils";

// Unlike the dashboard's CopyButton, this one shows a transient check icon instead of a toast,
// so the hosted app doesn't need the whole toast/toaster infrastructure mounted.
const CopyButton = forwardRefIfNeeded<
  HTMLButtonElement,
  ButtonProps & { content: string }
>(({ content, children, ...props }, ref) => {
  const [copied, setCopied] = useState(false);
  const resetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimeout.current) {
        clearTimeout(resetTimeout.current);
      }
    };
  }, []);

  return (
    <Button
      variant="secondary"
      {...props}
      className={cn(children == null ? "h-6 w-6 p-1" : "gap-1.5", props.className)}
      ref={ref}
      onClick={async (...args) => {
        await props.onClick?.(...args);
        await navigator.clipboard.writeText(content);
        setCopied(true);
        if (resetTimeout.current) {
          clearTimeout(resetTimeout.current);
        }
        resetTimeout.current = setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
      {children != null && <span>{children}</span>}
    </Button>
  );
});
CopyButton.displayName = "CopyButton";

export { CopyButton };
