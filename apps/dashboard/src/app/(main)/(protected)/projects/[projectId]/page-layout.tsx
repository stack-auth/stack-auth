import { cn, Typography } from "@/components/ui";
import React from "react";

export function PageLayout(props: {
  children?: React.ReactNode,
  title?: string,
  description?: string | React.ReactNode,
  actions?: React.ReactNode,
  fillWidth?: boolean,
} & ({
  fillWidth: true,
} | {
  width?: number,
})) {
  return (
    <div className="py-4 px-4 sm:py-6 sm:px-6 flex justify-center flex-1">
      <div
        className={cn("min-w-0 flex flex-col w-full max-w-7xl")}
        style={{
          maxWidth: props.fillWidth ? undefined : (props.width ?? 1250),
          width: props.fillWidth ? '100%' : (props.width ?? 1250),
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-6">
          <div className="space-y-1">
            {props.title && (
              <Typography type="h2" className="text-xl sm:text-2xl font-semibold tracking-tight">
                {props.title}
              </Typography>
            )}
            {props.description && (
              <Typography type={typeof props.description === "string" ? "p" : "div"} variant="secondary" className="text-sm">
                {props.description}
              </Typography>
            )}
          </div>
          {props.actions && (
            <div className="flex-shrink-0">
              {props.actions}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-4 flex-1">
          {props.children}
        </div>
      </div>
    </div>
  );
}
