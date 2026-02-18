"use client";

import { cn } from "@/lib/utils";
import { InfoIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { TooltipPortal } from "@radix-ui/react-tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export function SimpleTooltip(props: {
  tooltip: React.ReactNode,
  children?: React.ReactNode,
  type?: 'info' | 'warning',
  inline?: boolean,
  className?: string,
  disabled?: boolean,
}) {
  const iconClassName = cn("w-4 h-4 text-muted-foreground", props.inline && "inline");
  const icon = props.type === 'warning' ?
    <WarningCircleIcon className={iconClassName} /> :
    props.type === 'info' ?
      <InfoIcon className={iconClassName} /> :
      null;

  const trigger = (
    <>{icon}{props.children}</>
  );

  return (
    <Tooltip delayDuration={0} open={props.disabled ? false : undefined} disableHoverableContent={false}>
      <TooltipTrigger asChild>
        {props.inline ? (
          <span className={cn(props.className)}>
            {trigger}
          </span>
        ) : (
          <div className={cn("flex items-center gap-1", props.className)}>
            {trigger}
          </div>
        )}
      </TooltipTrigger>
      {props.tooltip && <TooltipPortal>
        <TooltipContent className="pointer-events-auto">
          <div className="max-w-60 text-center text-wrap whitespace-pre-wrap">
            {props.tooltip}
          </div>
        </TooltipContent>
      </TooltipPortal>}
    </Tooltip>
  );
}

