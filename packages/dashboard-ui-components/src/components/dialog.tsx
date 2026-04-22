"use client";

import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  cn,
} from "@stackframe/stack-ui";
import React from "react";

export type DesignDialogSize =
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl"
  | "4xl"
  | "5xl"
  | "6xl"
  | "7xl"
  | "full";

export type DesignDialogVariant = "glassmorphic" | "plain";

const dialogSizeClasses = new Map<DesignDialogSize, string>([
  ["sm", "max-w-sm"],
  ["md", "max-w-md"],
  ["lg", "max-w-lg"],
  ["xl", "max-w-xl"],
  ["2xl", "max-w-2xl"],
  ["3xl", "max-w-3xl"],
  ["4xl", "max-w-4xl"],
  ["5xl", "max-w-5xl"],
  ["6xl", "max-w-6xl"],
  ["7xl", "max-w-7xl"],
  ["full", "max-w-[calc(100vw-2rem)]"],
]);

const dialogSurfaceClasses = new Map<DesignDialogVariant, string>([
  ["glassmorphic", "border-0 sm:rounded-2xl bg-background/85 backdrop-blur-2xl ring-1 ring-foreground/[0.06] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.25),0_4px_24px_-8px_rgba(0,0,0,0.12)] dark:bg-background/80 dark:ring-white/[0.06]"],
  ["plain", "border bg-background shadow-lg sm:rounded-lg"],
]);

const dialogOverlayClasses = new Map<DesignDialogVariant, string | undefined>([
  ["glassmorphic", "bg-black/50 backdrop-blur-sm"],
  ["plain", undefined],
]);

type DesignDialogIcon = React.ElementType<{ className?: string }>;

type DesignDialogRootProps = Omit<React.ComponentProps<typeof Dialog>, "children">;

export type DesignDialogProps = {
  trigger?: React.ReactElement,
  size?: DesignDialogSize,
  variant?: DesignDialogVariant,
  icon?: DesignDialogIcon | null,
  title?: React.ReactNode,
  description?: React.ReactNode,
  headerContent?: React.ReactNode,
  customHeader?: React.ReactNode,
  footer?: React.ReactNode,
  noBodyPadding?: boolean,
  hideTopCloseButton?: boolean,
  className?: string,
  overlayClassName?: string,
  headerClassName?: string,
  bodyClassName?: string,
  footerClassName?: string,
  children?: React.ReactNode,
} & DesignDialogRootProps;

/**
 * Canonical dashboard modal surface. This wraps the base dialog primitives with
 * a reusable glassmorphic shell and consistent header/body/footer regions.
 */
export function DesignDialog({
  trigger,
  size = "lg",
  variant = "glassmorphic",
  icon: Icon = null,
  title,
  description,
  headerContent,
  customHeader,
  footer,
  noBodyPadding = false,
  hideTopCloseButton = false,
  className,
  overlayClassName,
  headerClassName,
  bodyClassName,
  footerClassName,
  children,
  ...dialogRootProps
}: DesignDialogProps) {
  const resolvedSizeClass = dialogSizeClasses.get(size) ?? "max-w-lg";
  const resolvedSurfaceClass = dialogSurfaceClasses.get(variant) ?? dialogSurfaceClasses.get("glassmorphic");
  const resolvedOverlayClass = cn(dialogOverlayClasses.get(variant), overlayClassName);
  const shouldRenderTopHeaderRow = Icon != null || title != null || description != null;
  const shouldRenderHeader = customHeader != null || shouldRenderTopHeaderRow || headerContent != null;
  const shouldRenderBody = React.Children.count(children) > 0;

  return (
    <Dialog {...dialogRootProps}>
      {trigger != null && (
        <DialogTrigger asChild>
          {trigger}
        </DialogTrigger>
      )}

      <DialogContent
        className={cn(
          "gap-0 p-0 overflow-hidden",
          resolvedSizeClass,
          resolvedSurfaceClass,
          className
        )}
        overlayProps={resolvedOverlayClass ? { className: resolvedOverlayClass } : undefined}
        noCloseButton={hideTopCloseButton}
      >
        {shouldRenderHeader && (
          <DialogHeader className={cn("px-6 pt-6 pb-4 border-b border-foreground/[0.06]", headerClassName)}>
            {customHeader ?? (
              <>
                {shouldRenderTopHeaderRow && (
                  <div className={cn("flex items-start gap-3", Icon == null && "gap-0")}>
                    {Icon != null && (
                      <div className="h-9 w-9 rounded-xl bg-primary/10 ring-1 ring-primary/15 flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    {(title != null || description != null) && (
                      <div className="flex-1 min-w-0 space-y-1">
                        {title != null ? (
                          <DialogTitle className="text-base">
                            {title}
                          </DialogTitle>
                        ) : null}
                        {description != null ? (
                          <DialogDescription className="text-xs">
                            {description}
                          </DialogDescription>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}

                {headerContent != null ? (
                  <div className={cn(shouldRenderTopHeaderRow && "mt-4")}>
                    {headerContent}
                  </div>
                ) : null}
              </>
            )}
          </DialogHeader>
        )}

        {shouldRenderBody && (
          <DialogBody
            className={cn(
              "mx-0 my-0 w-auto",
              noBodyPadding ? "px-0 py-0" : "px-6 py-4",
              bodyClassName
            )}
          >
            {children}
          </DialogBody>
        )}

        {footer != null ? (
          <DialogFooter className={cn("px-6 py-3 border-t border-foreground/[0.06] bg-foreground/[0.02]", footerClassName)}>
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export const DesignDialogRoot = Dialog;
export const DesignDialogTrigger = DialogTrigger;
export const DesignDialogClose = DialogClose;
export const DesignDialogTitle = DialogTitle;
export const DesignDialogDescription = DialogDescription;
