"use client";

import { Button, cn } from "@/components/ui";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
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

  const handleCopy = useCallback(() => {
    runAsynchronouslyWithAlert(async () => {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
    });
  }, [props.value]);

  return (
    <div className={cn("flex items-center gap-2 min-w-0", props.className)}>
      <InlineCode className="truncate min-w-0">{props.value}</InlineCode>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 flex-shrink-0"
        onClick={handleCopy}
        title={copied ? "Copied!" : "Copy to clipboard"}
      >
        {copied ? (
          <CheckIcon className="h-4 w-4 text-emerald-500" />
        ) : (
          <CopyIcon className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
});
