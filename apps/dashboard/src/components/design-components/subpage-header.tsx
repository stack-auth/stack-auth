"use client";

import { Button, Typography } from "@/components/ui";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { ReactNode } from "react";

type SubpageHeaderProps = {
  title: string,
  onBack: () => void,
  actions?: ReactNode,
};

export function SubpageHeader({ title, onBack, actions }: SubpageHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
      <div className="flex items-center gap-3 min-w-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 shrink-0"
          onClick={onBack}
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>

        <Typography className="font-semibold text-foreground truncate">
          {title}
        </Typography>
      </div>

      {actions != null && (
        <div className="flex items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
