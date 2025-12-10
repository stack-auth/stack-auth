"use client";

import { Button, cn } from "@stackframe/stack-ui";
import { Check, Copy } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { InlineCode } from "./inline-code";

export const CopyableText = React.memo(function CopyableText(props: {
  value: string,
  label?: string,
  className?: string,
}) {
  const [copied, setCopied] = useState(false);

  // Cleanup timeout on unmount to prevent memory leaks
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [props.value]);

  return (
    <div className={cn("flex items-center gap-2", props.className)}>
      <InlineCode>{props.value}</InlineCode>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={handleCopy}
        title={copied ? "Copied!" : "Copy to clipboard"}
      >
        {copied ? (
          <Check className="h-4 w-4 text-emerald-500" />
        ) : (
          <Copy className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
});
