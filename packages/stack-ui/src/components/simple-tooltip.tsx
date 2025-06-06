import { CircleAlert, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from "..";

export function SimpleTooltip(props: {
  tooltip: React.ReactNode,
  children?: React.ReactNode,
  type?: 'info' | 'warning',
  inline?: boolean,
  className?: string,
  disabled?: boolean,
}) {
  const iconClassName = cn("w-4 h-4 text-zinc-500", props.inline && "inline");
  const icon = props.type === 'warning' ?
    <CircleAlert className={iconClassName} /> :
    props.type === 'info' ?
      <Info className={iconClassName} /> :
      null;

  const trigger = (
    <>{icon}{props.children}</>
  );

  return (
    <TooltipProvider>
      <Tooltip open={props.disabled ? false : undefined}>
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
        <TooltipContent>
          <div className="max-w-60 text-center text-wrap whitespace-pre-wrap">
            {props.tooltip}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
